import { describe, expect, it } from 'vitest'
import { DRAG_THRESHOLD, cellAtPoint, isDragGesture, pointInRect, type CellRect } from './drag'

describe('isDragGesture', () => {
  it('keeps a short press a tap', () => {
    expect(isDragGesture(100, 100, 100, 100)).toBe(false)
    expect(isDragGesture(100, 100, 103, 104)).toBe(false)
  })

  it('turns into a drag once the threshold is reached', () => {
    expect(isDragGesture(100, 100, 100 + DRAG_THRESHOLD, 100)).toBe(true)
    expect(isDragGesture(100, 100, 100, 100 - DRAG_THRESHOLD - 1)).toBe(true)
  })

  it('measures travel in any direction, not just one axis', () => {
    // 4-4 is ~5.66, under the 6px threshold; 5-5 is ~7.07, over it
    expect(isDragGesture(0, 0, 4, 4)).toBe(false)
    expect(isDragGesture(0, 0, 5, 5)).toBe(true)
  })

  it('takes a custom threshold', () => {
    expect(isDragGesture(0, 0, 0, 20, 30)).toBe(false)
    expect(isDragGesture(0, 0, 0, 30, 30)).toBe(true)
  })
})

describe('pointInRect', () => {
  const rect = { left: 10, top: 20, right: 60, bottom: 70 }

  it('accepts a point inside and on the edges', () => {
    expect(pointInRect(rect, 30, 40)).toBe(true)
    expect(pointInRect(rect, 10, 20)).toBe(true)
    expect(pointInRect(rect, 60, 70)).toBe(true)
  })

  it('rejects a point outside on any side', () => {
    expect(pointInRect(rect, 9, 40)).toBe(false)
    expect(pointInRect(rect, 61, 40)).toBe(false)
    expect(pointInRect(rect, 30, 19)).toBe(false)
    expect(pointInRect(rect, 30, 71)).toBe(false)
  })
})

describe('cellAtPoint', () => {
  const rects: CellRect[] = [
    { index: 0, left: 0, top: 0, right: 100, bottom: 100 },
    { index: 1, left: 100, top: 0, right: 200, bottom: 100 },
    { index: 2, left: 0, top: 100, right: 100, bottom: 200 },
    { index: 3, left: 100, top: 100, right: 200, bottom: 200 },
  ]

  it('finds the cell under the pointer', () => {
    expect(cellAtPoint(rects, 50, 50)).toBe(0)
    expect(cellAtPoint(rects, 150, 50)).toBe(1)
    expect(cellAtPoint(rects, 50, 150)).toBe(2)
    expect(cellAtPoint(rects, 150, 150)).toBe(3)
  })

  it('counts the edges as inside the cell', () => {
    expect(cellAtPoint(rects, 0, 0)).toBe(0)
    expect(cellAtPoint(rects, 100, 100)).toBe(0)
    expect(cellAtPoint(rects, 200, 200)).toBe(3)
  })

  it('returns nothing off the board', () => {
    expect(cellAtPoint(rects, -1, 50)).toBeNull()
    expect(cellAtPoint(rects, 50, -1)).toBeNull()
    expect(cellAtPoint(rects, 201, 50)).toBeNull()
    expect(cellAtPoint([], 50, 50)).toBeNull()
  })
})
