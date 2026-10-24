/**
 * Pointer maths for dragging a digit from the pad onto the board.
 *
 * Kept away from the DOM so the two things that can be wrong — when a press
 * becomes a drag, and which cell is under the pointer — are testable.
 */

/** Travel (px) before a press counts as a drag rather than a tap. */
export const DRAG_THRESHOLD = 6

export interface CellRect {
  index: number
  left: number
  top: number
  right: number
  bottom: number
}

export type Rect = Omit<CellRect, 'index'>

export function isDragGesture(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = DRAG_THRESHOLD,
): boolean {
  return Math.hypot(x - startX, y - startY) >= threshold
}

/** Edges count as inside, so a release on a cell border still lands. */
export function pointInRect(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/** The cell containing the point, or `null` when the pointer is off the board. */
export function cellAtPoint(rects: CellRect[], x: number, y: number): number | null {
  for (const rect of rects) {
    if (pointInRect(rect, x, y)) return rect.index
  }
  return null
}
