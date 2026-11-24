import { Capacitor, CapacitorHttp } from '@capacitor/core'

// 访问用户自己的 WebDAV 网盘（决策 0029 第 3a 条）。网盘上的文件都是文本（加密后再 base64），
// 这样安卓原生请求和浏览器 fetch 走同一套，不用处理二进制。
// 安卓 App 里用原生请求，没有跨域限制；浏览器里多数网盘会被跨域挡住，出错时提示改用 App

export type DavConfig = { url: string; user: string; password: string }
export type DavResponse = { status: number; text: string; etag: string | null }
export type Transport = (req: {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}) => Promise<DavResponse>

const header = (h: Record<string, string>, name: string) => {
  const k = Object.keys(h).find((x) => x.toLowerCase() === name)
  return k ? h[k] : null
}

export const nativeTransport: Transport = async (req) => {
  const res = await CapacitorHttp.request({
    method: req.method,
    url: req.url,
    headers: req.headers,
    data: req.body,
    responseType: 'text',
  })
  return {
    status: res.status,
    text:
      typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? ''),
    etag: header(res.headers ?? {}, 'etag'),
  }
}

export const fetchTransport: Transport = async (req) => {
  let res: Response
  try {
    res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    })
  } catch {
    throw new Error(
      '连不上网盘。浏览器通常不允许网页直接访问网盘（跨域限制），请在安卓 App 里同步，或检查网盘地址',
    )
  }
  return {
    status: res.status,
    text: await res.text(),
    etag: res.headers.get('etag'),
  }
}

export const defaultTransport = () =>
  Capacitor.isNativePlatform() ? nativeTransport : fetchTransport

// 网盘里放本 App 文件的目录，比如 https://dav.jianguoyun.com/dav/ + footprint-journal/
export const DIR = 'footprint-journal'

export class Dav {
  private base: string
  private auth: string
  private send: Transport
  constructor(config: DavConfig, send: Transport = defaultTransport()) {
    this.send = send
    this.base = `${config.url.replace(/\/+$/, '')}/${DIR}/`
    // btoa 只认 Latin-1：账号密码先按 UTF-8 编码
    const raw = new TextEncoder().encode(`${config.user}:${config.password}`)
    this.auth = `Basic ${btoa(String.fromCharCode(...raw))}`
  }

  private async req(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: string,
  ) {
    const res = await this.send({
      method,
      url: this.base + path,
      headers: { Authorization: this.auth, ...headers },
      body,
    })
    if (res.status === 401 || res.status === 403)
      throw new Error('网盘账号或应用密码不对')
    return res
  }

  // 没有这个文件时返回 null
  async get(
    path: string,
  ): Promise<{ text: string; etag: string | null } | null> {
    const res = await this.req('GET', path)
    if (res.status === 404) return null
    if (res.status >= 300) throw new Error(`读取网盘失败（${res.status}）`)
    return { text: res.text, etag: res.etag }
  }

  // ifMatch：只有网盘上还是这个版本才写（null 表示必须是新文件）；被别人改过时返回 false
  async put(
    path: string,
    text: string,
    ifMatch?: string | null,
  ): Promise<boolean> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
    }
    if (ifMatch === null) headers['If-None-Match'] = '*'
    else if (ifMatch) headers['If-Match'] = ifMatch
    const res = await this.req('PUT', path, headers, text)
    if (res.status === 412) return false
    if (res.status >= 300) throw new Error(`写入网盘失败（${res.status}）`)
    return true
  }

  async remove(path: string) {
    await this.req('DELETE', path).catch(() => {})
  }

  // 建目录；已经有了（405）也算成功
  async ensureDirs() {
    for (const dir of ['', 'photos/']) {
      const res = await this.req('MKCOL', dir)
      if (res.status >= 300 && res.status !== 405 && res.status !== 301)
        throw new Error(`在网盘上建目录失败（${res.status}）`)
    }
  }
}
