import { describe, expect, it } from 'vitest'
import {
  MAX_DISK_PRIMARY_PERCENT,
  MAX_DISK_TONE_PERCENT,
  MAX_DISK_WIDTH_PERCENT,
  MIN_DISK_PRIMARY_PERCENT,
  MIN_DISK_TONE_PERCENT,
  MIN_DISK_WIDTH_PERCENT,
  diskLiftShadow,
  diskPrimaryPercent,
  diskShadow,
  diskSurface,
  diskTonePercent,
  diskWidthPercent,
} from './visuals'

const SIZES = [3, 4, 5, 6, 7, 8]

describe('diskWidthPercent', () => {
  it('gives the smallest and largest disks the documented widths', () => {
    expect(diskWidthPercent(1, 6)).toBe(MIN_DISK_WIDTH_PERCENT)
    expect(diskWidthPercent(6, 6)).toBe(MAX_DISK_WIDTH_PERCENT)
  })

  it('grows with every disk, so no two disks are the same width', () => {
    for (const disks of SIZES) {
      const widths = Array.from({ length: disks }, (_, i) => diskWidthPercent(i + 1, disks))
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1])
      expect(new Set(widths).size).toBe(disks)
    }
  })

  it('never reaches the card edges', () => {
    expect(diskWidthPercent(8, 8)).toBeLessThan(90)
  })

  it('survives a single-disk board and out-of-range input', () => {
    expect(diskWidthPercent(1, 1)).toBe(MIN_DISK_WIDTH_PERCENT)
    expect(diskWidthPercent(0, 6)).toBe(MIN_DISK_WIDTH_PERCENT)
    expect(diskWidthPercent(99, 6)).toBe(MAX_DISK_WIDTH_PERCENT)
  })
})

describe('diskTonePercent', () => {
  it('ramps from the lightest smallest disk to the most solid largest', () => {
    expect(diskTonePercent(1, 6)).toBe(MIN_DISK_TONE_PERCENT)
    expect(diskTonePercent(6, 6)).toBe(MAX_DISK_TONE_PERCENT)
  })

  it('is monotonic, so bigger always means more solid', () => {
    for (const disks of SIZES) {
      const tones = Array.from({ length: disks }, (_, i) => diskTonePercent(i + 1, disks))
      for (let i = 1; i < tones.length; i++) expect(tones[i]).toBeGreaterThan(tones[i - 1])
    }
  })

  it('keeps every disk saturated enough to stay visible on the board', () => {
    // mixing too far toward the board colour is what made the old disks vanish
    expect(MIN_DISK_TONE_PERCENT).toBeGreaterThanOrEqual(60)
    expect(diskTonePercent(1, 8)).toBeGreaterThanOrEqual(60)
  })
})

describe('diskPrimaryPercent', () => {
  it('shifts from the secondary hue on the smallest disk to the primary on the largest', () => {
    expect(diskPrimaryPercent(1, 6)).toBe(MIN_DISK_PRIMARY_PERCENT)
    expect(diskPrimaryPercent(6, 6)).toBe(MAX_DISK_PRIMARY_PERCENT)
  })

  it('is monotonic, so the hue order matches the size order', () => {
    for (const disks of SIZES) {
      const hues = Array.from({ length: disks }, (_, i) => diskPrimaryPercent(i + 1, disks))
      for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeGreaterThan(hues[i - 1])
    }
  })
})

describe('diskSurface', () => {
  it('builds a lit-top to shaded-bottom gradient from the ramp values', () => {
    const surface = diskSurface(3, 6)
    expect(surface).toContain('linear-gradient(180deg')
    expect(surface).toContain('white')
    expect(surface).toContain('black')
    expect(surface).toContain(`${diskTonePercent(3, 6)}%`)
    expect(surface).toContain(`${diskPrimaryPercent(3, 6)}%`)
    expect(surface).toContain('var(--color-primary)')
    expect(surface).toContain('var(--color-secondary)')
    expect(surface).toContain('var(--color-base-100)')
  })

  it('gives every disk on the board a distinct surface', () => {
    const surfaces = Array.from({ length: 8 }, (_, i) => diskSurface(i + 1, 8))
    expect(new Set(surfaces).size).toBe(8)
  })
})

describe('diskShadow', () => {
  it('adds a rim so the boundary is visible, plus a contact shadow', () => {
    const shadow = diskShadow()
    expect(shadow).toContain('inset')
    expect(shadow).toContain('rgb(0 0 0')
    expect(shadow).toContain('var(--color-base-content)')
  })
})

describe('diskLiftShadow', () => {
  it('adds a primary glow so the disk in hand is unmistakable', () => {
    const shadow = diskLiftShadow()
    expect(shadow).toContain('var(--color-primary)')
    expect(shadow).toContain('inset')
  })

  it('casts a deeper shadow than a resting disk', () => {
    const blurOf = (shadow: string) => {
      const drop = shadow.split(',').find((part) => part.includes('rgb(0 0 0')) ?? ''
      return Number(drop.match(/(\d+)px (\d+)px/)?.[2] ?? 0)
    }
    expect(blurOf(diskLiftShadow())).toBeGreaterThan(blurOf(diskShadow()))
  })
})
