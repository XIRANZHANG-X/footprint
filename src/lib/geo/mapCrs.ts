import L from 'leaflet'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../../shared/gcj02.ts'

// 国内底图用高德（决策 0021）。高德的瓦片是按 GCJ-02 画的，我们的点、线、区域都是 WGS-84。
// 做法：给 Leaflet 一个"先把 WGS-84 换成 GCJ-02 再投影"的坐标系。这样地图上所有东西
// （标记、路线、点亮的区域）照旧用 WGS-84 坐标，画出来自动对上高德的底图；
// 点地图拿到的坐标也自动换回 WGS-84。只在显示高德底图时用这个坐标系。

const mercator = L.Projection.SphericalMercator

const gcjProjection: L.Projection = {
  ...mercator,
  project(latlng: L.LatLng) {
    const g = wgs84ToGcj02({ lat: latlng.lat, lng: latlng.lng })
    return mercator.project(L.latLng(g.lat, g.lng))
  },
  unproject(point: L.Point) {
    const ll = mercator.unproject(point)
    const w = gcj02ToWgs84({ lat: ll.lat, lng: ll.lng })
    return L.latLng(w.lat, w.lng)
  },
}

export const GCJ_CRS: L.CRS = L.Util.extend({}, L.CRS.EPSG3857, {
  projection: gcjProjection,
})

// 高德的瓦片分两层（2026-11-24 实测，决策 0021）：
// - 底图（style=7）：水、绿地、道路，没有文字；有 512 像素的高清版（scl=2），按 256 显示，手机上很清楚
// - 文字层（style=8）：透明的道路和中文地名；高清版不带文字，只能用普通的 256 像素版，手机上文字会软一点
// 这些地址不在高德公开的文档里，哪天不能用了就换高德自己的地图库（决策 0021 的接法 b）
export const AMAP_TILE_URL =
  'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=2&style=7'
export const AMAP_LABEL_URL =
  'https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=8'
export const AMAP_ATTRIBUTION = '&copy; 高德地图'
