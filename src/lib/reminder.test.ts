import { describe, expect, it } from 'vitest'
import { autoBackupDue, backupReminder, inNativeApp } from './reminder.ts'

const DAY = 86_400_000
const now = 100 * DAY

describe('backupReminder', () => {
  it('stays quiet when there are no records', () => {
    expect(backupReminder([], null, now)).toEqual({
      unbacked: 0,
      remind: false,
    })
  })

  it('does not nag right after a first record', () => {
    expect(backupReminder([{ createdAt: now - DAY }], null, now)).toEqual({
      unbacked: 1,
      remind: false,
    })
  })

  it('reminds once the oldest unbacked record is a week old', () => {
    expect(
      backupReminder([{ createdAt: now - 7 * DAY }], null, now).remind,
    ).toBe(true)
  })

  it('only counts records created after the last backup', () => {
    const records = [
      { createdAt: now - 30 * DAY },
      { createdAt: now - 2 * DAY },
    ]
    expect(backupReminder(records, now - 10 * DAY, now)).toEqual({
      unbacked: 1,
      remind: false,
    })
  })

  it('is quiet when everything is backed up', () => {
    expect(
      backupReminder([{ createdAt: now - 30 * DAY }], now - DAY, now),
    ).toEqual({
      unbacked: 0,
      remind: false,
    })
  })
})

describe('auto backup (Android app)', () => {
  const DAY = 86_400_000
  it('is due a week after the last backup, or when never backed up', () => {
    expect(autoBackupDue(3, null, 10 * DAY)).toBe(true)
    expect(autoBackupDue(3, 4 * DAY, 10 * DAY)).toBe(false)
    expect(autoBackupDue(3, 3 * DAY, 10 * DAY)).toBe(true)
  })

  it('never runs with no records', () => {
    expect(autoBackupDue(0, null, 10 * DAY)).toBe(false)
  })

  it('only counts as the native app when Capacitor says so', () => {
    expect(inNativeApp()).toBe(false)
  })
})
