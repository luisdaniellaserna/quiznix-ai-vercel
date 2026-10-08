/**
 * Canonical Tower of Hanoi rules.
 *
 * Plain ESM on purpose: the browser bundles it through Vite, and the room
 * server (Phase 2, group race) can import the exact same file with Node —
 * no duplicated rule logic, no build step.
 *
 * A board is three pegs of disk sizes ordered bottom-first, so peg[0] is the
 * base of the stack and peg[peg.length - 1] is the top disk. Disks are
 * numbered 1..n by size. The puzzle is solved when every disk sits on the
 * last peg (index 2), largest at the bottom.
 */

export const MIN_DISKS = 3
export const MAX_DISKS = 8

export const PEG_COUNT = 3
export const TARGET_PEG = PEG_COUNT - 1

export function createBoard(disks) {
  assertDiskCount(disks)
  const stack = []
  for (let size = disks; size >= 1; size--) stack.push(size)
  return [stack, [], []]
}

export function optimalMoves(disks) {
  assertDiskCount(disks)
  return 2 ** disks - 1
}

/**
 * Every disk buys one hint, so the allowance scales with the puzzle: 3 disks
 * give 3 hints, 8 give 8. It lives here rather than in the component because
 * the group race will need to enforce the same allowance server-side.
 */
export function hintsAllowed(disks) {
  assertDiskCount(disks)
  return disks
}

export function topDisk(board, peg) {
  const stack = board[peg]
  return stack.length > 0 ? stack[stack.length - 1] : null
}

export function isLegalMove(board, from, to) {
  if (from === to) return false
  if (!isPeg(board, from) || !isPeg(board, to)) return false
  const moving = topDisk(board, from)
  if (moving === null) return false
  const resting = topDisk(board, to)
  return resting === null || moving < resting
}

/** Returns a new board; throws on an illegal move so bad input can never land. */
export function applyMove(board, from, to) {
  if (!isLegalMove(board, from, to)) {
    throw new Error(`Illegal move: peg ${from} -> peg ${to}`)
  }
  const next = board.map((stack) => [...stack])
  next[to].push(next[from].pop())
  return next
}

export function isSolved(board, disks) {
  assertDiskCount(disks)
  const target = board[TARGET_PEG]
  if (target.length !== disks) return false
  for (let i = 0; i < disks; i++) {
    if (target[i] !== disks - i) return false
  }
  return true
}

/**
 * Fewest moves still needed from any legal state. Doubles as a correctness
 * oracle for nextHint: replaying hints must take exactly this many moves.
 */
export function remainingMoves(board, disks) {
  assertDiskCount(disks)
  return planRemaining(board, disks, TARGET_PEG)
}

/**
 * The next move of an optimal solution from any legal state, or null when the
 * puzzle is already solved. Lets the UI answer "what would a perfect player
 * do next?" without shipping a precomputed solution.
 */
export function nextHint(board, disks) {
  assertDiskCount(disks)
  if (isSolved(board, disks)) return null
  return planMove(board, disks, TARGET_PEG)
}

function planRemaining(board, disks, target) {
  if (disks === 0) return 0
  const position = pegOf(board, disks)
  if (position === target) return planRemaining(board, disks - 1, target)
  const staging = otherPeg(position, target)
  return planRemaining(board, disks - 1, staging) + 1 + (2 ** (disks - 1) - 1)
}

function planMove(board, disks, target) {
  if (disks === 0) return null
  const position = pegOf(board, disks)
  // The largest disk is already home, so the rest of the work is on top of it.
  if (position === target) return planMove(board, disks - 1, target)
  const staging = otherPeg(position, target)
  // Free the staging peg first: once the smaller disks are out of the way, the
  // only move left before the largest disk can travel is its own.
  const inner = planMove(board, disks - 1, staging)
  return inner ?? { from: position, to: target }
}

function pegOf(board, disk) {
  for (let peg = 0; peg < board.length; peg++) {
    if (board[peg].includes(disk)) return peg
  }
  throw new Error(`Disk ${disk} is missing from the board`)
}

function otherPeg(from, to) {
  for (let peg = 0; peg < PEG_COUNT; peg++) {
    if (peg !== from && peg !== to) return peg
  }
  throw new Error('No staging peg available')
}

function isPeg(board, peg) {
  return Number.isInteger(peg) && peg >= 0 && peg < board.length
}

function assertDiskCount(disks) {
  if (!Number.isInteger(disks) || disks < MIN_DISKS || disks > MAX_DISKS) {
    throw new RangeError(`Disks must be an integer between ${MIN_DISKS} and ${MAX_DISKS}`)
  }
}
