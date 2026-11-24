import { Capacitor, registerPlugin } from '@capacitor/core'

// 把生成的文件（分享图、备份 zip）交给用户。
// 网页版：用临时链接触发浏览器下载。
// 安卓 App：WebView 不支持 <a download>，也没有网页的系统分享，
// 所以先写到 App 的缓存目录，再打开系统分享面板，可以存到文件或发到微信（决策 0009）。
// 分享图在 App 里还会先存进系统相册（shareImageNative）。
// 只在按需加载的页面（备份页、分享预览）里使用，不会进首屏代码。

export const isNativeApp = () => Capacitor.isNativePlatform()

// 安卓端自己写的插件：android/app/src/main/java/.../GallerySaverPlugin.java
const GallerySaver = registerPlugin<{
  saveImage(options: { data: string; name: string }): Promise<{ uri: string }>
}>('GallerySaver')

export async function saveFile(blob: Blob, name: string): Promise<void> {
  if (isNativeApp()) return shareNative(await writeCacheFile(blob, name), name)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// App 里点"分享"：先存进相册（相簿"足迹手账"），再打开分享面板。
// 存相册失败不拦着分享，只把原因返回给界面显示。
export async function shareImageNative(
  blob: Blob,
  name: string,
): Promise<
  { savedToGallery: true } | { savedToGallery: false; reason: string }
> {
  const data = await toBase64(blob)
  let result: Awaited<ReturnType<typeof shareImageNative>>
  try {
    await GallerySaver.saveImage({ data, name })
    result = { savedToGallery: true }
  } catch (e) {
    result = {
      savedToGallery: false,
      reason: e instanceof Error ? e.message : String(e),
    }
  }
  await shareNative(await writeCacheFile(blob, name), name)
  return result
}

// 一次分享几张图（长图分页、朋友圈多图，决策 0014 第 3B 条）：逐张存进相册，再一起交给分享面板
export async function shareImagesNative(
  files: File[],
): Promise<
  { savedToGallery: true } | { savedToGallery: false; reason: string }
> {
  const datas = await Promise.all(files.map(toBase64))
  let result: Awaited<ReturnType<typeof shareImagesNative>> = {
    savedToGallery: true,
  }
  for (const [i, data] of datas.entries()) {
    try {
      await GallerySaver.saveImage({ data, name: files[i].name })
    } catch (e) {
      result = {
        savedToGallery: false,
        reason: e instanceof Error ? e.message : String(e),
      }
      break
    }
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const uris: string[] = []
  for (const [i, data] of datas.entries())
    uris.push(
      (
        await Filesystem.writeFile({
          path: files[i].name,
          data,
          directory: Directory.Cache,
        })
      ).uri,
    )
  try {
    await Share.share({ files: uris })
  } catch (e) {
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e
  }
  return result
}

// 写进 App 的缓存目录，返回文件地址。分块写：备份可能几百 MB，
// 一次只把 3 MB 转成 base64，不把整个文件变成一个大字符串（决策 0019 第 2 条）
const WRITE_CHUNK = 3 * 1024 * 1024

export async function writeCacheFile(
  blob: Blob,
  name: string,
): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const first = await Filesystem.writeFile({
    path: name,
    data: await toBase64(blob.slice(0, WRITE_CHUNK)),
    directory: Directory.Cache,
  })
  for (let start = WRITE_CHUNK; start < blob.size; start += WRITE_CHUNK)
    await Filesystem.appendFile({
      path: name,
      data: await toBase64(blob.slice(start, start + WRITE_CHUNK)),
      directory: Directory.Cache,
    })
  return first.uri
}

async function shareNative(uri: string, name: string) {
  const { Share } = await import('@capacitor/share')
  try {
    await Share.share({ title: name, files: [uri] })
  } catch (e) {
    // 用户关掉分享面板也会抛错，这不算失败
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e
  }
}

// Filesystem 和相册插件都只接受 base64 字符串
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error ?? new Error('读取文件失败'))
    r.readAsDataURL(blob)
  })
}
