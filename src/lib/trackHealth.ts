import type { TrackEvent } from '../db.ts'
import type { TrackPoint } from './track.ts'

// 记录体检（决策 0030）：把后台服务留下的心跳和轨迹点，算成"记了多久、断了几次、耗多少电、点准不准"。
// 纯函数，方便测试。电量是整机的，不只是足迹手账；所以耗电只算"两次心跳都在锁屏、都没充电"的时段，
// 这时手机基本只剩后台任务，最接近后台记录的消耗

export const GAP_MS = 45 * 60_000 // 心跳 15 分钟一次，系统会推迟；超过 45 分钟没有任何动静算断档
const HOUR = 3_600_000

export type Gap = { from: number; to: number }
export type SessionHealth = {
  start: number
  end: number
  endedBy: 'stop' | 'lost' | 'running' | 'unknown'
  precise: boolean
  hours: number
  gaps: Gap[]
  lostAfter: number | null // 被系统停了：最后一次确认还活着的时间
  idleDrainPerHour: number | null // 锁屏、没充电时每小时掉多少电（百分点）
  idleHours: number // 上面这个数是按多少小时算的
  points: number
  bySource: Record<string, number>
  medianAcc: number | null
  networkMissing: boolean // 这台手机没有网络定位（省电模式靠它）
  gpsOff: boolean // GPS 被关了（精确模式靠它）
}

type Grouped = { events: TrackEvent[]; endedBy: SessionHealth['endedBy'] }

// 按 start 切成一次次记录；还没结束的那次，看现在是不是还在记
export function sessions(events: TrackEvent[], running: boolean): Grouped[] {
  const sorted = [...events].sort((a, b) => a.t - b.t)
  const out: Grouped[] = []
  let cur: TrackEvent[] | null = null
  const close = (endedBy: Grouped['endedBy']) => {
    if (cur) out.push({ events: cur, endedBy })
    cur = null
  }
  for (const e of sorted) {
    if (e.ev === 'start') {
      // 上一次没收到 stop / lost 就又开始了：上一次怎么结束的不知道
      close('unknown')
      cur = [e]
    } else if (cur) {
      cur.push(e)
      if (e.ev === 'stop' || e.ev === 'lost') close(e.ev)
    }
  }
  close(running ? 'running' : 'unknown')
  return out
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const provState = (prov: string, name: string) =>
  prov
    .split(',')
    .map((x) => x.split(':'))
    .find(([k]) => k === name)?.[1]

export function sessionHealth(
  g: Grouped,
  points: Pick<TrackPoint, 't' | 'acc' | 'src'>[],
  now: number,
): SessionHealth {
  const ev = g.events
  const first = ev[0]
  const last = ev[ev.length - 1]
  const seen = g.endedBy === 'running' ? now : last.t
  const inside = points.filter((p) => p.t >= first.t && p.t <= seen)

  // 活着的证据：心跳、事件、轨迹点。被系统停了的那条 lost 是"发现"的时间，不算活着
  const alive = [
    ...ev.filter((e) => e.ev !== 'lost').map((e) => e.t),
    ...inside.map((p) => p.t),
  ].sort((a, b) => a - b)
  const gaps: Gap[] = []
  for (let i = 1; i < alive.length; i++)
    if (alive[i] - alive[i - 1] > GAP_MS)
      gaps.push({ from: alive[i - 1], to: alive[i] })
  if (g.endedBy === 'running' && now - alive[alive.length - 1] > GAP_MS)
    gaps.push({ from: alive[alive.length - 1], to: now })
  const lostAfter = g.endedBy === 'lost' ? alive[alive.length - 1] : null
  // 被系统停了的那次，时长只算到最后一次确认还活着（发现被停的时间往往晚很多）
  const end = lostAfter ?? seen

  let drop = 0
  let idle = 0
  for (let i = 1; i < ev.length; i++) {
    const a = ev[i - 1]
    const b = ev[i]
    if (a.bat < 0 || b.bat < 0 || a.chg || b.chg) continue
    if (a.scr !== false || b.scr !== false) continue
    if (b.t - a.t > GAP_MS) continue // 中间断过，不知道发生了什么
    drop += Math.max(0, a.bat - b.bat)
    idle += (b.t - a.t) / HOUR
  }

  const bySource: Record<string, number> = {}
  for (const p of inside) bySource[p.src] = (bySource[p.src] ?? 0) + 1
  const prov = last.prov || first.prov

  return {
    start: first.t,
    end,
    endedBy: g.endedBy,
    precise: first.precise,
    hours: (end - first.t) / HOUR,
    gaps,
    lostAfter,
    // 少于 1 小时的锁屏时段，电量只精确到 1%，算出来的数没意义
    idleDrainPerHour: idle >= 1 ? drop / idle : null,
    idleHours: idle,
    points: inside.length,
    bySource,
    medianAcc: median(inside.flatMap((p) => (p.acc === null ? [] : [p.acc]))),
    networkMissing: provState(prov, 'network') === 'none',
    gpsOff: provState(prov, 'gps') !== 'on',
  }
}

// 对标 Polarsteps 自称的"一天约 4%"，省电模式定 5%/天；精确模式 15%/天（见 docs/tracking-polish.md）
export const DRAIN_TARGET_PER_DAY = { saving: 5, precise: 15 }

export type Finding = { level: 'bad' | 'warn' | 'ok'; text: string }

const hm = (t: number) => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function findings(s: SessionHealth): Finding[] {
  const out: Finding[] = []
  if (s.lostAfter !== null)
    out.push({
      level: 'bad',
      text: `${hm(s.lostAfter)} 之后被系统停了，之后的路线没记到`,
    })
  if (s.endedBy === 'unknown')
    out.push({
      level: 'warn',
      text: `${hm(s.end)} 之后没有消息，可能被系统停了`,
    })
  for (const g of s.gaps)
    out.push({
      level: 'bad',
      text: `${hm(g.from)} 到 ${hm(g.to)} 之间断了 ${Math.round((g.to - g.from) / 60_000)} 分钟`,
    })
  if (!s.precise && s.networkMissing)
    out.push({
      level: 'bad',
      text: '这台手机没有网络定位，省电模式几乎记不到点。先用精确模式',
    })
  if (s.precise && s.gpsOff)
    out.push({ level: 'warn', text: 'GPS 是关着的，精确模式记不准' })
  if (s.hours >= 2 && s.points === 0)
    out.push({ level: 'bad', text: '记了两个多小时，一个点都没有' })
  if (s.idleDrainPerHour !== null) {
    const perDay = s.idleDrainPerHour * 24
    const target = DRAIN_TARGET_PER_DAY[s.precise ? 'precise' : 'saving']
    out.push({
      level: perDay > target ? 'warn' : 'ok',
      text: `锁屏时每小时掉电 ${s.idleDrainPerHour.toFixed(1)}%（按 ${s.idleHours.toFixed(1)} 小时算），折合一天 ${perDay.toFixed(0)}%；目标 ${target}% 以内（这是整机耗电，包含手机自己待机）`,
    })
  }
  if (out.every((f) => f.level === 'ok'))
    out.unshift({ level: 'ok', text: '没有断档' })
  return out
}
