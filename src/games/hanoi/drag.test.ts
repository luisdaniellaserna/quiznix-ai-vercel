import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD_PX, PEG_SLOP_PX, isDragGesture, pegAtPoint, type PegRect } from './drag'

/** Three 100x200 pegs with a 20px gap, laid out like the real board. */
const PEGS: PegRect[] = [
  { peg: 0, left: 0, top: 0, right: 100, bottom: 200 },
  { peg: 1, left: 120, top: 0, right: 220, bottom: 200 },
  { peg: 2, left: 240, top: 0, right: 340, bottom: 200 },
]

const BELOW = 200 + PEG_SLOP_PX + 1
const ABOVE = -PEG_SLOP_PX - 1

describe('pegAtPoint', () => {
  it('finds the peg under the pointer', () => {
    expect(pegAtPoint(PEGS, 50, 100)).toBe(0)
    expect(pegAtPoint(PEGS, 170, 100)).toBe(1)
    expect(pegAtPoint(PEGS, 300, 100)).toBe(2)
  })

  it('accepts points just outside a peg, within the slop margin', () => {
    // 5px past peg 0's right edge, still nearest to peg 0
    expect(pegAtPoint(PEGS, 105, 100)).toBe(0)
    // 5px inside peg 1's left edge
    expect(pegAtPoint(PEGS, 115, 100)).toBe(1)
    // 5px below the pegs
    expect(pegAtPoint(PEGS, 50, 205)).toBe(0)
  })

  it('snaps a release in the gap between pegs to the nearest one', () => {
    // the slop margins tile the 20px gap, so a sloppy drop is forgiving
    expect(pegAtPoint(PEGS, 106, 100)).toBe(0)
    expect(pegAtPoint(PEGS, 114, 100)).toBe(1)
    expect(pegAtPoint(PEGS, 110, 100)).toBe(0)
  })

  it('returns null well outside the board, so releasing away from the pegs cancels', () => {
    expect(pegAtPoint(PEGS, 340 + PEG_SLOP_PX + 1, 100)).toBe(null)
    expect(pegAtPoint(PEGS, ABOVE, 100)).toBe(null)
    expect(pegAtPoint(PEGS, 50, BELOW)).toBe(null)
    expect(pegAtPoint(PEGS, 400, BELOW)).toBe(null)
  })

  it('ignores pegs that are not in the list', () => {
    expect(pegAtPoint([], 50, 100)).toBe(null)
    expect(pegAtPoint(PEGS.slice(0, 2), 300, 100)).toBe(null)
  })

  it('honours a custom slop', () => {
    expect(pegAtPoint(PEGS, 105, 100, 0)).toBe(null)
    expect(pegAtPoint(PEGS, 105, 100, 10)).toBe(0)
  })
})

describe('isDragGesture', () => {
  it('treats a motionless tap as a tap, not a drag', () => {
    expect(isDragGesture(50, 50, 50, 50)).toBe(false)
    expect(isDragGesture(50, 50, 53, 50)).toBe(false)
  })

  it('treats movement past the threshold as a drag', () => {
    expect(isDragGesture(50, 50, 50 + DRAG_THRESHOLD_PX, 50)).toBe(true)
    expect(isDragGesture(50, 50, 55, 50)).toBe(true)
    expect(isDragGesture(50, 50, 50, 60)).toBe(true)
  })

  it('measures diagonally, not per axis', () => {
    // 3px on each axis is a 4.2px move — past a 4px threshold
    expect(isDragGesture(0, 0, 3, 3)).toBe(true)
    expect(isDragGesture(0, 0, 20, 3, 25)).toBe(false)
  })
})
