import { Capacitor, registerPlugin } from '@capacitor/core'

// 从相册"分享"进 App（决策 0023）：原生那边把照片复制到缓存目录，这里读成 File，
// 交给和"选照片"一样的新建流程。照片字节原样复制，拍摄时间、位置都还在

// android/app/src/main/java/.../ShareInPlugin.java
const ShareIn = registerPlugin<{
  take(): Promise<{ files: { path: string; name: string; type: string }[] }>
  addListener(
    event: 'shared',
    cb: () => void,
  ): Promise<{ remove: () => Promise<void> }>
}>('ShareIn')

export async function takeSharedPhotos(): Promise<File[]> {
  const { files } = await ShareIn.take()
  const out: File[] = []
  for (const f of files) {
    try {
      const blob = await (await fetch(Capacitor.convertFileSrc(f.path))).blob()
      out.push(new File([blob], f.name, { type: f.type || blob.type }))
    } catch {
      // 读不出来的那张跳过
    }
  }
  return out
}

// 打开 App 时取一次（App 没开着时分享进来的），之后每次有新的分享再取
export async function watchSharedPhotos(
  onPhotos: (files: File[]) => void,
): Promise<() => void> {
  const take = () =>
    void takeSharedPhotos()
      .then((files) => {
        if (files.length) onPhotos(files)
      })
      .catch(() => {})
  take()
  const handle = await ShareIn.addListener('shared', take)
  return () => void handle.remove()
}
