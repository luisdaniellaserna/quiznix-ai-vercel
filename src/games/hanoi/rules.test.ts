import { describe, expect, it } from 'vitest'
import {
  MAX_DISKS,
  MIN_DISKS,
  applyMove,
  createBoard,
  hintsAllowed,
  isLegalMove,
  isSolved,
  nextHint,
  optimalMoves,
  remainingMoves,
  topDisk,
} from '../../../shared/hanoiRules.mjs'

/** Follow the hint trail to the end: returns the moves taken. */
function followHints(board: number[][], disks: number) {
  const moves: { from: number; to: number }[] = []
  let current = board
  for (let guard = 0; guard < 1000; guard++) {
    const hint = nextHint(current, disks)
    if (!hint) return moves
    current = applyMove(current, hint.from, hint.to)
    moves.push(hint)
  }
  throw new Error('hint trail did not terminate')
}

describe('createBoard', () => {
  it('stacks every disk on the first peg, largest at the bottom', () => {
    expect(createBoard(3)).toEqual([[3, 2, 1], [], []])
    expect(createBoard(8)[0]).toEqual([8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('rejects disk counts outside the supported range', () => {
    expect(() => createBoard(MIN_DISKS - 1)).toThrow(RangeError)
    expect(() => createBoard(MAX_DISKS + 1)).toThrow(RangeError)
    expect(() => createBoard(3.5)).toThrow(RangeError)
  })
})

describe('optimalMoves', () => {
  it('is 2^n - 1 for every supported size', () => {
    for (let disks = MIN_DISKS; disks <= MAX_DISKS; disks++) {
      expect(optimalMoves(disks)).toBe(2 ** disks - 1)
    }
    expect(optimalMoves(3)).toBe(7)
    expect(optimalMoves(8)).toBe(255)
  })
})

describe('hintsAllowed', () => {
  it('allows one hint per disk, so the allowance scales with the puzzle', () => {
    for (let disks = MIN_DISKS; disks <= MAX_DISKS; disks++) {
      expect(hintsAllowed(disks)).toBe(disks)
    }
    expect(hintsAllowed(3)).toBe(3)
    expect(hintsAllowed(8)).toBe(8)
  })

  it('rejects sizes outside the supported range', () => {
    expect(() => hintsAllowed(MIN_DISKS - 1)).toThrow(RangeError)
    expect(() => hintsAllowed(MAX_DISKS + 1)).toThrow(RangeError)
  })
})

describe('isLegalMove', () => {
  it('allows moving the top disk onto an empty peg or a larger disk', () => {
    const board = createBoard(3)
    expect(isLegalMove(board, 0, 1)).toBe(true)
    expect(isLegalMove(board, 0, 2)).toBe(true)
    const afterOne = applyMove(board, 0, 1)
    // disk 1 now rests on peg 1, so disk 2 can only travel to the empty peg 2
    expect(isLegalMove(afterOne, 0, 2)).toBe(true)
  })

  it('rejects a same-peg move, an empty peg, and a bigger disk onto a smaller one', () => {
    const board = createBoard(3)
    expect(isLegalMove(board, 0, 0)).toBe(false)
    expect(isLegalMove(board, 1, 0)).toBe(false)
    const afterOne = applyMove(board, 0, 1)
    // peg 0 now holds [3,2] and peg 1 holds [1]: 2 may not land on 1
    expect(isLegalMove(afterOne, 0, 1)).toBe(false)
  })
})

describe('applyMove', () => {
  it('returns a new board and leaves the original untouched', () => {
    const board = createBoard(3)
    const moved = applyMove(board, 0, 2)
    expect(moved).toEqual([[3, 2], [], [1]])
    expect(board).toEqual([[3, 2, 1], [], []])
    expect(moved).not.toBe(board)
  })

  it('throws on an illegal move', () => {
    expect(() => applyMove(createBoard(3), 1, 0)).toThrow()
  })
})

describe('topDisk', () => {
  it('reads the top disk, or null for an empty peg', () => {
    const board = createBoard(3)
    expect(topDisk(board, 0)).toBe(1)
    expect(topDisk(board, 1)).toBe(null)
  })
})

describe('isSolved', () => {
  it('is true only when every disk is stacked on the last peg', () => {
    const board = createBoard(3)
    expect(isSolved(board, 3)).toBe(false)
    expect(isSolved([[], [], [3, 2, 1]], 3)).toBe(true)
    expect(isSolved([[], [1], [3, 2]], 3)).toBe(false)
  })
})

describe('nextHint', () => {
  it('returns null once the puzzle is solved', () => {
    expect(nextHint([[], [], [3, 2, 1]], 3)).toBe(null)
  })

  it('solves from a fresh board in exactly the optimal number of moves', () => {
    for (let disks = MIN_DISKS; disks <= 6; disks++) {
      const moves = followHints(createBoard(disks), disks)
      expect(moves).toHaveLength(optimalMoves(disks))
    }
  })

  it('takes exactly the remaining optimal moves from a mid-game state', () => {
    let board = createBoard(5)
    board = applyMove(board, 0, 2)
    board = applyMove(board, 0, 1)
    board = applyMove(board, 2, 1)
    const expected = remainingMoves(board, 5)
    expect(followHints(board, 5)).toHaveLength(expected)
  })
})

describe('remainingMoves', () => {
  it('matches the optimal count from the start and zero when solved', () => {
    expect(remainingMoves(createBoard(4), 4)).toBe(optimalMoves(4))
    expect(remainingMoves([[], [], [4, 3, 2, 1]], 4)).toBe(0)
  })
})
