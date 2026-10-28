import {
  MAX_DISKS,
  MIN_DISKS,
  PEG_COUNT,
  applyMove,
  createBoard,
  hintsAllowed,
  isSolved,
} from '../shared/hanoiRules.mjs'

/**
 * Tower of Hanoi race rules, server-side. The client solves locally and submits
 * one move log at the finish; the server replays it so a claimed solve is only
 * trusted when the moves are legal and the board truly ends solved. No board
 * state is streamed — the puzzle is fully determined by its disk count.
 */

// A race needs an opponent; a host alone cannot race.
export const HANOI_MIN_PLAYERS = 2
// Bound the replay: a legal solve of ≤8 disks rarely exceeds a few hundred
// moves, and the whole log rides one ≤64 KiB frame.
export const HANOI_MAX_MOVES = 2048

export function assertValidDisks(disks) {
  if (!Number.isInteger(disks) || disks < MIN_DISKS || disks > MAX_DISKS) {
    throw new Error(`Disks must be an integer between ${MIN_DISKS} and ${MAX_DISKS}.`)
  }
}

function validPeg(value) {
  return Number.isInteger(value) && value >= 0 && value < PEG_COUNT
}

/**
 * Replays a submitted move log against a fresh board and returns the validated
 * `{ moves, hintsUsed }`. Throws on a malformed log, an illegal move, an
 * over-allowance hint count, or a board that does not end solved.
 */
export function validateSolve({ disks, moves, hintsUsed }) {
  assertValidDisks(disks)
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > HANOI_MAX_MOVES) {
    throw new Error('Invalid move log.')
  }
  if (!Number.isInteger(hintsUsed) || hintsUsed < 0 || hintsUsed > hintsAllowed(disks)) {
    throw new Error('Invalid hint count.')
  }
  let board = createBoard(disks)
  for (const move of moves) {
    if (!move || !validPeg(move.from) || !validPeg(move.to)) {
      throw new Error('Invalid move log.')
    }
    // applyMove throws on an illegal move, so bad input can never land
    board = applyMove(board, move.from, move.to)
  }
  if (!isSolved(board, disks)) {
    throw new Error('The puzzle is not solved.')
  }
  return { moves: moves.length, hintsUsed }
}

/** Finishers first (fastest, then fewest moves, then fewest hints), then name. */
function comparator(a, b) {
  const aFinished = a.status === 'finished' ? 0 : 1
  const bFinished = b.status === 'finished' ? 0 : 1
  if (aFinished !== bFinished) return aFinished - bFinished
  if (aFinished === 0) {
    if (a.finishedAt !== b.finishedAt) return a.finishedAt - b.finishedAt
    if (a.moves !== b.moves) return a.moves - b.moves
    if (a.hintsUsed !== b.hintsUsed) return a.hintsUsed - b.hintsUsed
  }
  return a.name.localeCompare(b.name)
}

/**
 * Sorts raw seats (finished/dnf/pending) into standings and stamps each with a
 * 1-based rank and an elapsed time measured from the race start.
 */
export function rankHanoi(entries, startedAt) {
  return [...entries].sort(comparator).map((entry, index) => ({
    playerId: entry.playerId,
    name: entry.name,
    status: entry.status,
    rank: index + 1,
    finishedAt: entry.finishedAt ?? 0,
    elapsedMs:
      entry.status === 'finished' && startedAt ? Math.max(0, entry.finishedAt - startedAt) : 0,
    moves: entry.moves ?? 0,
    hintsUsed: entry.hintsUsed ?? 0,
  }))
}
