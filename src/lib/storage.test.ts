import { describe, expect, it } from 'vitest'
import { isQuotaError, saveErrorMessage } from './storage.ts'

const named = (name: string, extra: object = {}) =>
  Object.assign(new Error(name), { name, ...extra })

describe('isQuotaError', () => {
  it('认得浏览器直接抛出的空间不足错误', () => {
    expect(isQuotaError(named('QuotaExceededError'))).toBe(true)
  })

  it('认得被 Dexie 包了一层或两层的空间不足错误', () => {
    const quota = named('QuotaExceededError')
    expect(isQuotaError(named('AbortError', { inner: quota }))).toBe(true)
    expect(
      isQuotaError(
        named('BulkError', { inner: named('AbortError', { inner: quota }) }),
      ),
    ).toBe(true)
    expect(isQuotaError(named('Error', { cause: quota }))).toBe(true)
  })

  it('其他错误和非错误值都不算', () => {
    expect(isQuotaError(named('AbortError'))).toBe(false)
    expect(isQuotaError('QuotaExceededError')).toBe(false)
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError(undefined)).toBe(false)
  })

  it('循环引用不会卡死', () => {
    const a = named('AbortError') as Error & { inner?: unknown }
    a.inner = a
    expect(isQuotaError(a)).toBe(false)
  })
})

describe('saveErrorMessage', () => {
  it('空间不足时告诉用户该怎么办', () => {
    const msg = saveErrorMessage(named('QuotaExceededError'))
    expect(msg).toContain('存储空间不够')
    expect(msg).toContain('备份')
  })

  it('其他错误原样带上原因', () => {
    expect(saveErrorMessage(new Error('磁盘读写失败'))).toBe(
      '保存失败：磁盘读写失败',
    )
    expect(saveErrorMessage('boom')).toBe('保存失败：boom')
  })
})
