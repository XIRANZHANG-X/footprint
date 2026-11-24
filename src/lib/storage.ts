// 和存储状态相关的小工具，单独放一个文件：主页面要用它们，
// 但不应该因此把备份用的 zip 库（fflate）一起打进首屏代码。

const LAST_BACKUP_KEY = 'footprint-journal:lastBackupAt'

// 上次备份时间只用于提醒，丢了顶多多提醒一次，所以放 localStorage 就够了
export function getLastBackupAt(): number | null {
  try {
    const v = localStorage.getItem(LAST_BACKUP_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function setLastBackupAt(t: number | null) {
  try {
    if (t === null) localStorage.removeItem(LAST_BACKUP_KEY)
    else localStorage.setItem(LAST_BACKUP_KEY, String(t))
  } catch {
    // 隐私模式等情况下写不进去，不影响备份本身
  }
}

// 申请持久化存储：浏览器同意后，空间紧张时不会自动清掉这个网站的数据（决策 0004）
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

// 存储空间不够时浏览器抛 QuotaExceededError；Dexie 会把它包一层（放在 inner 里），
// 事务中止时外层名字还可能变成 AbortError，所以顺着 inner / cause 往里找
export function isQuotaError(e: unknown): boolean {
  for (let cur = e, depth = 0; cur && depth < 5; depth++) {
    if (typeof cur !== 'object') return false
    const err = cur as { name?: unknown; inner?: unknown; cause?: unknown }
    if (err.name === 'QuotaExceededError') return true
    cur = err.inner ?? err.cause
  }
  return false
}

// 保存失败时给用户看的话（决策 0011）
export function saveErrorMessage(e: unknown): string {
  if (isQuotaError(e))
    return '这台设备留给 App 的存储空间不够了，这次没有保存。请先到"备份"页导出备份，再删掉一些旧记录或清理手机空间后重试。'
  return `保存失败：${e instanceof Error ? e.message : String(e)}`
}

// 访问口令（决策 0008）。放 localStorage：只在这台设备的这个网站里可读；
// 清除浏览器数据后重新输入一次即可
const ACCESS_TOKEN_KEY = 'footprint-journal:accessToken'

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAccessToken(token: string | null) {
  try {
    if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token)
    else localStorage.removeItem(ACCESS_TOKEN_KEY)
  } catch {
    // 写不进去时只是下次还要再输入
  }
}
