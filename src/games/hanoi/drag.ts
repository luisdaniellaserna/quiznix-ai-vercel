/**
 * Geometry for dragging a Hanoi disk onto a peg.
 *
 * Kept free of DOM access so it can be unit tested; the component only feeds it
 * cached element rects and pointer coordinates.
 */

export interface PegRect {
  peg: number
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Points this far outside a peg still count as being on it. Chosen to be wider
 * than the gap between pegs, so a sloppy release snaps to the nearest peg
 * instead of silently cancelling — cancelling needs a release clearly away from
 * the board (see `pegAtPoint` returning null).
 */
export const PEG_SLOP_PX = 12

/** Movement below this is a tap, not a drag. */
export const DRAG_THRESHOLD_PX = 4

/**
 * The peg a release at (x, y) lands on, or null to cancel.
 *
 * When two slop margins overlap (the narrow gap between pegs) the peg whose
 * centre is closest wins, so the drop always matches what the highlight showed.
 */
export function pegAtPoint(
  rects: PegRect[],
  x: number,
  y: number,
  slop: number = PEG_SLOP_PX,
): number | null {
  let best: { peg: number; distance: number } | null = null
  for (const rect of rects) {
    const inside =
      x >= rect.left - slop &&
      x <= rect.right + slop &&
      y >= rect.top - slop &&
      y <= rect.bottom + slop
    if (!inside) continue
    const distance = Math.hypot(x - (rect.left + rect.right) / 2, y - (rect.top + rect.bottom) / 2)
    if (!best || distance < best.distance) best = { peg: rect.peg, distance }
  }
  return best ? best.peg : null
}

/** True once the pointer has travelled far enough to count as a drag. */
export function isDragGesture(
  startX: number,
  startY: number,
  x: number,
  y: number,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(x - startX, y - startY) >= threshold
}
