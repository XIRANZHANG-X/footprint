import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CATEGORIES } from '../../shared/ai.ts'
import type { JournalRecord } from '../db.ts'
import {
  areaKey,
  cityOf,
  GEO_VERSION,
  needsGeo,
  type Area,
} from './geo/area.ts'
import {
  cityFromPlaceName,
  cityNames,
  cluesToCities,
  lookupPhone,
  lookupPlate,
  type AdminItem,
  type PrefixTable,
} from './geo/cnTables.ts'
import { decodeRegions, locate, type EncodedFile } from './geo/pip.ts'
import { gridSlots, paginate } from './layout.ts'
import { buildReview, onThisDay, shiftPeriod } from './review.ts'
import { applyFilters, facets, NO_FILTERS, textHash } from './search.ts'
import { pickHits } from './semantic/pick.ts'
import { computeVisits, distanceM, visitLabel } from './visits.ts'

// 第三档（决策 0014）的纯逻辑。查表和边界用的是真实数据文件：
// public/data/cn 进了仓库；public/geo 由 scripts/prepare_assets.mjs 生成
const json = <T>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T

type Category = (typeof CATEGORIES)[number]

const H = 3_600_000
const day = (d: number, h = 12) => new Date(2026, 10, d, h).getTime()

function rec(p: Partial<JournalRecord> & { id: string }): JournalRecord {
  return {
    createdAt: 0,
    takenAt: day(1),
    timeSource: 'exif',
    location: null,
    locationStatus: 'pending',
    photoCount: 0,
    note: '',
    placeName: null,
    aiDraft: null,
    content: null,
    aiStatus: 'none',
    aiError: null,
    tripBreak: null,
    bodySource: 'own',
    placeGuess: null,
    aiTimings: null,
    ...p,
  }
}

const content = (
  title: string,
  category: Category = '美食',
  tags: string[] = [],
) => ({
  title,
  category,
  intro: '',
  tags,
})

const area = (p: Partial<Area> & { cc: string; admin1: string }): Area => ({
  key: '',
  gv: GEO_VERSION,
  a1: 0,
  county: null,
  ...p,
})

describe('visits', () => {
  const a = { lat: 30.25, lng: 120.15 }
  const near = { lat: 30.2505, lng: 120.1505 } // 约 70 米
  const far = { lat: 30.26, lng: 120.15 } // 约 1.1 公里

  it('measures distance in metres', () => {
    expect(Math.round(distanceM(a, near))).toBeGreaterThan(50)
    expect(distanceM(a, near)).toBeLessThan(100)
    expect(distanceM(a, far)).toBeGreaterThan(1000)
  })

  it('counts distinct days at the same place, not records', () => {
    const rs = [
      rec({ id: '1', takenAt: day(1, 10), location: a }),
      rec({ id: '2', takenAt: day(1, 15), location: near }), // 同一天、同一处
      rec({ id: '3', takenAt: day(5), location: near }),
      rec({ id: '4', takenAt: day(6), location: far }),
      rec({ id: '5', takenAt: day(7) }), // 没有坐标
    ]
    const { visits, places } = computeVisits(rs, () => null)
    expect(visits.get('1')?.visit).toBe(1)
    expect(visits.get('2')?.visit).toBe(1)
    expect(visits.get('3')?.visit).toBe(2)
    expect(visits.get('4')?.visit).toBe(1)
    expect(visits.has('5')).toBe(false)
    expect(places).toHaveLength(2)
    expect(visitLabel(visits.get('3')!)).toBe('第 2 次来')
    expect(visitLabel(visits.get('1')!)).toBe('第一次来')
  })

  it('marks only the first record in a city as the first visit', () => {
    const rs = [
      rec({ id: 'b', takenAt: day(2), location: far }),
      rec({ id: 'a', takenAt: day(1), location: a }),
    ]
    const { visits } = computeVisits(rs, () => '杭州市')
    expect(visits.get('a')?.firstInCity).toBe('杭州市')
    expect(visits.get('b')?.firstInCity).toBeNull()
  })
})

describe('search', () => {
  const rs = [
    rec({
      id: '1',
      content: content('麻辣火锅', '美食', ['火锅', '朋友']),
      note: '辣到流泪',
    }),
    rec({
      id: '2',
      content: content('西湖散步', '城市漫步', ['湖']),
      placeName: '西湖（杭州市 · 西湖区）',
    }),
    rec({ id: '3', note: '只写了几句，楼下咖啡' }),
  ]

  it('matches substrings across fields; all words must appear', () => {
    const q = (s: string) =>
      applyFilters(rs, { ...NO_FILTERS, q: s }, () => null).map((r) => r.id)
    expect(q('火锅')).toEqual(['1'])
    expect(q('杭州')).toEqual(['2'])
    expect(q('咖啡')).toEqual(['3'])
    expect(q('火锅 流泪')).toEqual(['1'])
    expect(q('火锅 西湖')).toEqual([])
  })

  it('filters by category, tag and city', () => {
    const cityOf = (r: JournalRecord) => (r.id === '2' ? '杭州市' : null)
    expect(
      applyFilters(rs, { ...NO_FILTERS, category: '美食' }, cityOf).map(
        (r) => r.id,
      ),
    ).toEqual(['1'])
    expect(
      applyFilters(rs, { ...NO_FILTERS, tag: '湖' }, cityOf).map((r) => r.id),
    ).toEqual(['2'])
    expect(
      applyFilters(rs, { ...NO_FILTERS, city: '杭州市' }, cityOf).map(
        (r) => r.id,
      ),
    ).toEqual(['2'])
    expect(facets(rs, cityOf).cities).toEqual([{ value: '杭州市', count: 1 }])
  })

  it('changes the text hash when the text changes', () => {
    expect(textHash('西湖')).toBe(textHash('西湖'))
    expect(textHash('西湖')).not.toBe(textHash('西湖边'))
  })
})

describe('semantic hit picking', () => {
  it('keeps hits above the floor and close to the best one', () => {
    const hits = pickHits([
      { recordId: 'a', score: 0.55 },
      { recordId: 'b', score: 0.5 },
      { recordId: 'c', score: 0.4 }, // 离最好的差 0.15
      { recordId: 'd', score: 0.3 },
    ])
    expect(hits.map((h) => h.recordId)).toEqual(['a', 'b'])
    expect(pickHits([{ recordId: 'x', score: 0.3 }])).toEqual([])
  })
})

describe('China lookup tables (from geo-sleuth)', () => {
  const phones = json<PrefixTable>('public/data/cn/area_codes.json')
  const plates = json<PrefixTable>('public/data/cn/plates.json')
  const admin = json<{ items: AdminItem[] }>('public/data/cn/admin.json').items
  const cities = cityNames(admin)

  it('maps landline area codes to cities and skips mobile numbers', () => {
    expect(lookupPhone('0571-88886666', phones)[0]?.admin2).toBe('杭州市')
    expect(lookupPhone('021 6888 8888', phones)[0]?.admin1).toBe('上海市')
    expect(lookupPhone('+86 571 8888 6666', phones)[0]?.admin2).toBe('杭州市')
    expect(lookupPhone('13812345678', phones)).toEqual([])
    expect(lookupPhone('400-123-4567', phones)).toEqual([])
  })

  it('maps plate prefixes to cities', () => {
    expect(lookupPlate('浙A·12345', plates)[0]?.admin2).toBe('杭州市')
    expect(lookupPlate('沪B 12345', plates)[0]?.admin1).toBe('上海市')
    expect(lookupPlate('ABC123', plates)).toEqual([])
  })

  it('lists each city once with where it came from', () => {
    expect(
      cluesToCities(
        { phones: ['0571-88886666'], plates: ['浙A12345'] },
        phones,
        plates,
      ),
    ).toEqual([{ city: '杭州市', via: '电话 0571-88886666' }])
  })

  it('pulls a prefecture-level city out of a place name', () => {
    expect(
      cityFromPlaceName('某某面馆（杭州市 · 西湖区 · 某路）', cities),
    ).toBe('杭州市')
    expect(cityFromPlaceName('上海市 · 黄浦区 · 南京东路', cities)).toBe(
      '上海市',
    )
    expect(cityFromPlaceName('西湖, 杭州市, 浙江省', cities)).toBe('杭州市')
    expect(cityFromPlaceName('楼下那家店', cities)).toBeNull()
  })
})

describe('area lookup (Natural Earth + geoBoundaries)', () => {
  // 文件里是整数差值编码（决策 0016 第 5 条），先解码
  const admin1File = json<EncodedFile<{ n: string; cc: string }>>(
    'public/geo/admin1.json',
  )
  const admin1 = {
    version: admin1File.version,
    features: decodeRegions(admin1File),
  }
  const counties = {
    features: decodeRegions(
      json<EncodedFile<{ n: string }>>('public/geo/cn-counties.json'),
    ),
  }

  it('uses the same data version as the app', () => {
    expect(admin1.version).toBe(GEO_VERSION)
  })

  it('finds the province or state of a point', () => {
    const at = (lat: number, lng: number) => {
      const i = locate(admin1.features, lat, lng)
      return i < 0 ? null : [admin1.features[i].cc, admin1.features[i].n]
    }
    expect(at(30.2741, 120.1551)).toEqual(['CN', '浙江省']) // 杭州
    expect(at(31.2304, 121.4737)).toEqual(['CN', '上海市'])
    expect(at(35.6762, 139.6503)?.[0]).toBe('JP') // 东京
    expect(at(30, -40)).toBeNull() // 大西洋中间
  })

  it('finds the county for a point in China', () => {
    expect(locate(counties.features, 30.2741, 120.1551)).toBeGreaterThanOrEqual(
      0,
    )
  })

  it('needs recomputing when the location changes', () => {
    const loc = { lat: 30.27, lng: 120.15 }
    const done = {
      location: loc,
      geoCity: '杭州市',
      area: area({ cc: 'CN', admin1: '浙江省', key: areaKey(loc) }),
    }
    expect(needsGeo(done)).toBe(false)
    expect(needsGeo({ ...done, location: { lat: 31, lng: 121 } })).toBe(true)
    expect(needsGeo({ ...done, geoCity: undefined })).toBe(true)
    expect(needsGeo({ location: null })).toBe(false)
  })

  it('names the city: prefecture in China, province or state abroad', () => {
    const loc = { lat: 1, lng: 1 }
    expect(
      cityOf({
        location: loc,
        geoCity: '杭州市',
        area: area({ cc: 'CN', admin1: '浙江省' }),
      }),
    ).toBe('杭州市')
    expect(
      cityOf({
        location: loc,
        geoCity: null,
        area: area({ cc: 'CN', admin1: '上海市' }),
      }),
    ).toBe('上海市')
    expect(
      cityOf({ location: loc, area: area({ cc: 'JP', admin1: '东京都' }) }),
    ).toBe('东京都')
    expect(
      cityOf({ location: loc, area: area({ cc: 'HK', admin1: '中西区' }) }),
    ).toBe('香港')
    expect(cityOf({ location: null })).toBeNull()
  })
})

describe('share layout helpers', () => {
  it('lays out up to nine photos in a grid', () => {
    expect(gridSlots(1, 300, 0)).toEqual([{ x: 0, y: 0, w: 300, h: 300 }])
    expect(gridSlots(4, 300, 0).map((s) => s.w)).toEqual([150, 150, 150, 150])
    expect(gridSlots(3, 300, 0).map((s) => s.y)).toEqual([0, 0, 0])
    const nine = gridSlots(12, 300, 0)
    expect(nine).toHaveLength(9)
    expect(nine[8]).toEqual({ x: 200, y: 200, w: 100, h: 100 })
  })

  it('splits long images between blocks, never inside one', () => {
    expect(paginate([100, 100, 100], 250)).toEqual([[0, 1], [2]])
    expect(paginate([300], 250)).toEqual([[0]]) // 一块本身太高也单独成页
    expect(paginate([], 250)).toEqual([[]])
  })
})

describe('review', () => {
  it('finds records from this day in earlier years', () => {
    const now = new Date(2026, 10, 23).getTime()
    const rs = [
      rec({
        id: '1',
        takenAt: new Date(2025, 10, 23, 9).getTime(),
        content: content('去年的面'),
      }),
      rec({ id: '2', takenAt: new Date(2026, 10, 23, 9).getTime() }), // 今年的不算
      rec({ id: '3', takenAt: new Date(2024, 10, 22).getTime() }),
    ]
    expect(onThisDay(rs, now)?.label).toBe('一年前的今天：去年的面')
    expect(onThisDay([rs[1]], now)).toBeNull()
  })

  it('moves between months across a year boundary', () => {
    expect(shiftPeriod({ kind: 'month', year: 2026, month: 12 }, 1)).toEqual({
      kind: 'month',
      year: 2027,
      month: 1,
    })
    expect(shiftPeriod({ kind: 'month', year: 2026, month: 1 }, -1)).toEqual({
      kind: 'month',
      year: 2025,
      month: 12,
    })
  })

  it('counts days, firsts and top places within the period only', () => {
    const p = { lat: 30.25, lng: 120.15 }
    const rs = [
      rec({
        id: 'old',
        takenAt: new Date(2026, 9, 3).getTime(),
        location: p,
        placeName: '老店',
      }),
      rec({
        id: 'a',
        takenAt: day(3),
        location: p,
        placeName: '老店',
        content: content('又来了'),
      }),
      rec({
        id: 'b',
        takenAt: day(4),
        location: { lat: 31, lng: 121 },
        placeName: '新店',
        content: content('第一次', '咖啡甜品'),
      }),
      rec({
        id: 'c',
        takenAt: day(4) + H,
        content: content('只写字', '咖啡甜品'),
      }),
    ]
    const r = buildReview(rs, { kind: 'month', year: 2026, month: 11 })
    expect(r.records.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(r.days).toBe(2)
    expect(r.firsts.map((f) => f.name)).toEqual(['新店']) // 老店 10 月就去过
    expect(r.topPlaces.map((t) => t.name).sort()).toEqual(['新店', '老店'])
    expect(r.categories[0]).toEqual({ name: '咖啡甜品', count: 2 })
  })
})
