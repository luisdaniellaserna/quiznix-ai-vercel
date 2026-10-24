import { describe, expect, it } from 'vitest'
import { formatDuration } from './format'

describe('formatDuration', () => {
  it('formats minutes, seconds and tenths', () => {
    expect(formatDuration(7_800)).toBe('0:07.8')
    expect(formatDuration(65_400)).toBe('1:05.4')
    expect(formatDuration(600_000)).toBe('10:00.0')
  })

  it('pads single-digit seconds so the clock does not jump around', () => {
    expect(formatDuration(9_000)).toBe('0:09.0')
  })

  it('falls back to zero for missing or negative input', () => {
    expect(formatDuration(0)).toBe('0:00.0')
    expect(formatDuration(Number.NaN)).toBe('0:00.0')
    expect(formatDuration(-500)).toBe('0:00.0')
  })
})
