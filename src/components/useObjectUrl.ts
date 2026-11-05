import { useEffect, useState } from 'react'

export function useObjectUrl(blob: Blob) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    // object URL 是要手动释放的外部资源，创建和释放必须成对放在同一个 effect 里。
    // 若改成渲染时 useMemo 创建，StrictMode 下 effect 会多跑一轮清理，把仍在使用的 URL 提前释放。
    const u = URL.createObjectURL(blob)
    // oxlint-disable-next-line react/set-state-in-effect
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
