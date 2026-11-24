// 同步的加密（决策 0029 第 3b 条）：同步口令 → PBKDF2（SHA-256，31 万次）→ AES-GCM 256 位钥匙。
// 每个文件一个随机 iv，放在密文前面，整体 base64。网盘上只有密文

export const PBKDF2_ROUNDS = 310_000
const CHECK = 'footprint-journal sync v1'

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.trim())
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function newSalt(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)))
}

export async function deriveKey(
  passphrase: string,
  salt: string,
  rounds = PBKDF2_ROUNDS,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromB64(salt),
      iterations: rounds,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function sealBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data),
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return toB64(out)
}

export async function openBytes(key: CryptoKey, text: string) {
  const all = fromB64(text)
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: all.subarray(0, 12) },
      key,
      all.subarray(12),
    ),
  )
}

export const seal = (key: CryptoKey, value: unknown) =>
  sealBytes(key, new TextEncoder().encode(JSON.stringify(value)))

export async function open<T>(key: CryptoKey, text: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await openBytes(key, text))) as T
}

// meta.json：明文的盐 + 一段校验密文。另一台设备用它检查口令对不对
export type SyncMeta = { v: 1; salt: string; rounds: number; check: string }

export async function newMeta(passphrase: string): Promise<{
  meta: SyncMeta
  key: CryptoKey
}> {
  const salt = newSalt()
  const key = await deriveKey(passphrase, salt)
  return {
    meta: { v: 1, salt, rounds: PBKDF2_ROUNDS, check: await seal(key, CHECK) },
    key,
  }
}

// 口令不对时返回 null
export async function unlock(
  passphrase: string,
  meta: SyncMeta,
): Promise<CryptoKey | null> {
  const key = await deriveKey(passphrase, meta.salt, meta.rounds)
  try {
    return (await open<string>(key, meta.check)) === CHECK ? key : null
  } catch {
    return null
  }
}
