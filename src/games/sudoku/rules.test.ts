import { describe, expect, it } from 'vitest'
import {
  boxOf,
  boxSize,
  candidates,
  cellCount,
  cellPeers,
  clearCellNotes,
  digits,
  emptyCells,
  emptyGrid,
  emptyNotes,
  findConflicts,
  isComplete,
  isSolved,
  prunePeerNotes,
  toggleNote,
  units,
  type Grid,
} from './rules'

function gridOf(rows: number[][]): Grid {
  return rows.flat()
}

/** A valid 4×4 solution, reused as the "solved" fixture. */
const SOLVED_4 = gridOf([
  [1, 2, 3, 4],
  [3, 4, 1, 2],
  [2, 1, 4, 3],
  [4, 3, 2, 1],
])

describe('board geometry', () => {
  it('knows its box size and cell count', () => {
    expect(boxSize(4)).toBe(2)
    expect(boxSize(9)).toBe(3)
    expect(cellCount(4)).toBe(16)
    expect(cellCount(9)).toBe(81)
  })

  it('describes every row, column and box exactly once', () => {
    expect(units(4)).toHaveLength(12)
    expect(units(9)).toHaveLength(27)
    for (const size of [4, 9] as const) {
      for (const unit of units(size)) expect(unit).toHaveLength(size)
      const covered = units(size).flat()
      expect(covered).toHaveLength(cellCount(size) * 3)
    }
  })

  it('maps cells onto their box', () => {
    expect(boxOf(9, 0)).toBe(0)
    expect(boxOf(9, 2)).toBe(0)
    expect(boxOf(9, 3)).toBe(1)
    expect(boxOf(9, 8)).toBe(2)
    expect(boxOf(9, 80)).toBe(8)
    expect(boxOf(4, 3)).toBe(1)
  })

  it('gives a cell the peers that share a row, column or box with it', () => {
    // a 9×9 cell sees 8 + 8 + 8, minus the 4 counted twice at the crossings
    expect(cellPeers(9, 40)).toHaveLength(20)
    expect(cellPeers(9, 0)).toHaveLength(20)
    // on a 4×4 the box overlaps the row and column on both sides
    expect(cellPeers(4, 0)).toHaveLength(7)
    expect(cellPeers(9, 40)).not.toContain(40)
  })
})

describe('conflicts', () => {
  it('finds nothing on an empty board', () => {
    expect(findConflicts(emptyGrid(9), 9).size).toBe(0)
  })

  it('flags both cells of a repeated digit in a row', () => {
    const grid = emptyGrid(9)
    grid[0] = 5
    grid[7] = 5
    expect([...findConflicts(grid, 9)].sort((a, b) => a - b)).toEqual([0, 7])
  })

  it('flags a repeat in a column', () => {
    const grid = emptyGrid(9)
    grid[2] = 7
    grid[2 + 9 * 4] = 7
    expect([...findConflicts(grid, 9)].sort((a, b) => a - b)).toEqual([2, 38])
  })

  it('flags a repeat inside a box', () => {
    const grid = emptyGrid(9)
    grid[0] = 3
    grid[10] = 3
    expect([...findConflicts(grid, 9)].sort((a, b) => a - b)).toEqual([0, 10])
  })

  it('flags every member of a triple', () => {
    const grid = emptyGrid(4)
    grid[0] = 2
    grid[1] = 2
    grid[3] = 2
    expect([...findConflicts(grid, 4)].sort((a, b) => a - b)).toEqual([0, 1, 3])
  })
})

describe('completion', () => {
  it('treats a filled, consistent board as solved', () => {
    expect(isComplete(SOLVED_4)).toBe(true)
    expect(isSolved(SOLVED_4, 4)).toBe(true)
  })

  it('rejects a filled board with a repeat', () => {
    const grid = SOLVED_4.slice()
    grid[1] = grid[0]
    expect(isComplete(grid)).toBe(true)
    expect(isSolved(grid, 4)).toBe(false)
  })

  it('rejects a half-filled board', () => {
    const grid = SOLVED_4.slice()
    grid[5] = 0
    expect(isComplete(grid)).toBe(false)
    expect(isSolved(grid, 4)).toBe(false)
  })

  it('lists the empty cells in order', () => {
    const grid = emptyGrid(4)
    grid[0] = 1
    grid[15] = 2
    expect(emptyCells(grid)).toHaveLength(14)
    expect(emptyCells(grid)).not.toContain(0)
    expect(emptyCells(grid)).not.toContain(15)
  })
})

describe('candidates', () => {
  it('offers every digit on an empty board', () => {
    expect(candidates(emptyGrid(4), 4, 0)).toEqual([1, 2, 3, 4])
  })

  it('removes the digits its peers already hold', () => {
    const grid = emptyGrid(4)
    grid[1] = 1 // same row
    grid[4] = 2 // same column
    grid[5] = 3 // same box
    expect(candidates(grid, 4, 0)).toEqual([4])
  })

  it('offers nothing for a filled cell', () => {
    const grid = SOLVED_4.slice()
    expect(candidates(grid, 4, 0)).toEqual([])
  })

  it('counts digits from one to the board size', () => {
    expect(digits(4)).toEqual([1, 2, 3, 4])
    expect(digits(9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})

describe('notes', () => {
  it('starts empty for every cell', () => {
    const notes = emptyNotes(4)
    expect(notes).toHaveLength(16)
    expect(notes.every((cell) => cell.length === 0)).toBe(true)
  })

  it('toggles a note on and off, keeping it sorted', () => {
    let notes = emptyNotes(9)
    notes = toggleNote(notes, 40, 7)
    notes = toggleNote(notes, 40, 2)
    expect(notes[40]).toEqual([2, 7])
    notes = toggleNote(notes, 40, 7)
    expect(notes[40]).toEqual([2])
  })

  it('never mutates the notes it was given', () => {
    const notes = emptyNotes(9)
    toggleNote(notes, 0, 4)
    prunePeerNotes(notes, 9, 0, 4)
    clearCellNotes(notes, 0)
    expect(notes[0]).toEqual([])
  })

  it('prunes a placed digit from every peer and nowhere else', () => {
    const notes = emptyNotes(9)
    notes[1] = [5, 9] // same row as cell 0
    notes[9] = [5, 8] // same column
    notes[10] = [5, 6] // same box
    notes[80] = [5] // unrelated
    notes[0] = [5] // the placed cell itself

    const pruned = prunePeerNotes(notes, 9, 0, 5)

    expect(pruned[1]).toEqual([9])
    expect(pruned[9]).toEqual([8])
    expect(pruned[10]).toEqual([6])
    expect(pruned[80]).toEqual([5])
    expect(pruned[0]).toEqual([5])
  })

  it('clears one cell without touching the rest', () => {
    const notes = emptyNotes(4)
    notes[0] = [1, 2]
    notes[1] = [3]
    const cleared = clearCellNotes(notes, 0)
    expect(cleared[0]).toEqual([])
    expect(cleared[1]).toEqual([3])
  })
})
