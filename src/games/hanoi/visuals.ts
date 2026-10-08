/**
 * Visual ramps for the Hanoi disks.
 *
 * The disks are ordered by size, so their look has to be ordered too: bigger
 * must read as more solid and more "primary", never as a random hue. Everything
 * here is derived from daisyUI theme tokens so the board follows all 35 themes,
 * and the size ordering is carried by three independent channels — the width
 * itself, the lightness ramp, and the hue ramp — which keeps it readable for
 * colourblind players instead of relying on hue alone.
 */

/** Narrower than the peg card, so disks never touch the edges. */
export const MIN_DISK_WIDTH_PERCENT = 34
export const MAX_DISK_WIDTH_PERCENT = 86

/**
 * How far each disk is mixed toward the board colour. Deliberately a modest
 * range: pulling the small disks further toward the background is what made the
 * old disks disappear into the board, and the floor keeps even the smallest
 * disk solid enough to read on a light theme.
 */
export const MIN_DISK_TONE_PERCENT = 74
export const MAX_DISK_TONE_PERCENT = 97

/** Hue split between the theme's secondary (smallest) and primary (largest). */
export const MIN_DISK_PRIMARY_PERCENT = 30
export const MAX_DISK_PRIMARY_PERCENT = 78

const MIN_DISKS = 1

/** 0 for the smallest disk, 1 for the largest. */
function rampPosition(disk: number, disks: number): number {
  const span = Math.max(1, disks - MIN_DISKS)
  const clamped = Math.min(Math.max(disk, MIN_DISKS), Math.max(disks, MIN_DISKS))
  return (clamped - MIN_DISKS) / span
}

function ramp(min: number, max: number, disk: number, disks: number): number {
  return Math.round(min + (max - min) * rampPosition(disk, disks))
}

export function diskWidthPercent(disk: number, disks: number): number {
  return ramp(MIN_DISK_WIDTH_PERCENT, MAX_DISK_WIDTH_PERCENT, disk, disks)
}

export function diskTonePercent(disk: number, disks: number): number {
  return ramp(MIN_DISK_TONE_PERCENT, MAX_DISK_TONE_PERCENT, disk, disks)
}

export function diskPrimaryPercent(disk: number, disks: number): number {
  return ramp(MIN_DISK_PRIMARY_PERCENT, MAX_DISK_PRIMARY_PERCENT, disk, disks)
}

/** The disk's flat colour: two theme hues blended, then mixed toward the board. */
function diskColor(disk: number, disks: number): string {
  const hue = `color-mix(in oklab, var(--color-primary) ${diskPrimaryPercent(disk, disks)}%, var(--color-secondary))`
  return `color-mix(in oklab, ${hue} ${diskTonePercent(disk, disks)}%, var(--color-base-100))`
}

/**
 * Lit top, shaded bottom — the same turned-wood logic as the pegs, so the two
 * read as one material. White/black rather than theme tokens because a light
 * source is the same in every theme.
 */
export function diskSurface(disk: number, disks: number): string {
  const color = diskColor(disk, disks)
  return `linear-gradient(180deg, color-mix(in oklab, ${color} 88%, white) 0%, ${color} 45%, color-mix(in oklab, ${color} 88%, black) 100%)`
}

/**
 * An inset rim (from base-content, so it stays visible against every theme's
 * board) plus a contact shadow that grounds the disk on the peg.
 */
export function diskShadow(): string {
  return 'inset 0 0 0 1px color-mix(in oklab, var(--color-base-content) 22%, transparent), 0 2px 4px rgb(0 0 0 / 0.28)'
}

/**
 * Emphasis for the disk in hand: a primary glow so it is unmistakable which
 * disk was picked up, plus a deeper shadow so it reads as lifted off the peg.
 */
export function diskLiftShadow(): string {
  return 'inset 0 0 0 1px color-mix(in oklab, var(--color-base-content) 22%, transparent), 0 0 0 3px color-mix(in oklab, var(--color-primary) 45%, transparent), 0 8px 18px rgb(0 0 0 / 0.35)'
}
