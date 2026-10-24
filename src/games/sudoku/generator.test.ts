import { describe, expect, it } from 'vitest'
import {
  DIFFICULTIES,
  clueTarget,
  countSolutions,
  generatePuzzle,
  mulberry32,
  type Puzzle,
} from './generator'
import { cellCount, emptyGrid, isSolved } from './rules'

function clueCount(puzzle: Puzzle): number {
  return puzzle.givens.filter((value) => value > 0).length
}

// one puzzle per board and difficulty, so the suite pays the generation cost once
const PUZZLES = {
  small: generatePuzzle({ size: 4, difficulty: 'beginner', seed: 7 }),
  easy: generatePuzzle({ size: 9, difficulty: 'easy', seed: 11 }),
  medium: generatePuzzle({ size: 9, difficulty: 'medium', seed: 13 }),
  hard: generatePuzzle({ size: 9, difficulty: 'hard', seed: 17 }),
}

describe('mulberry32', () => {
  it('replays the same stream for the same seed', () => {
    const first = mulberry32(42)
    const second = mulberry32(42)
    const stream = Array.from({ length: 5 }, () => first())
    expect(stream).toEqual(Array.from({ length: 5 }, () => second()))
  })

  it('stays inside [0, 1)', () => {
    const random = mulberry32(2024)
    for (let i = 0; i < 100; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('difficulties', () => {
  it('offers one setting for the small board and three for the classic one', () => {
    expect(DIFFICULTIES[4]).toEqual(['beginner'])
    expect(DIFFICULTIES[9]).toEqual(['easy', 'medium', 'hard'])
  })

  it('aims at fewer clues as the difficulty rises', () => {
    expect(clueTarget(9, 'easy')).toBeGreaterThan(clueTarget(9, 'medium'))
    expect(clueTarget(9, 'medium')).toBeGreaterThan(clueTarget(9, 'hard'))
    expect(clueTarget(4, 'beginner')).toBe(8)
  })

  it('rejects a difficulty the board does not offer', () => {
    expect(() => clueTarget(4, 'hard')).toThrow(RangeError)
    expect(() => generatePuzzle({ size: 4, difficulty: 'medium', seed: 1 })).toThrow(RangeError)
  })
})

describe('generatePuzzle', () => {
  it('builds the same puzzle twice from the same seed', () => {
    const again = generatePuzzle({ size: 9, difficulty: 'medium', seed: 13 })
    expect(again.givens).toEqual(PUZZLES.medium.givens)
    expect(again.solution).toEqual(PUZZLES.medium.solution)
  })

  it('builds a different puzzle from a different seed', () => {
    const other = generatePuzzle({ size: 9, difficulty: 'medium', seed: 99 })
    expect(other.givens).not.toEqual(PUZZLES.medium.givens)
  })

  for (const [label, puzzle] of Object.entries(PUZZLES)) {
    describe(`${label} (${puzzle.size}×${puzzle.size})`, () => {
      it('solves its own board', () => {
        expect(puzzle.solution).toHaveLength(cellCount(puzzle.size))
        expect(isSolved(puzzle.solution, puzzle.size)).toBe(true)
      })

      it('only shows clues that agree with the solution', () => {
        puzzle.givens.forEach((value, index) => {
          if (value === 0) return
          expect(value).toBe(puzzle.solution[index])
        })
      })

      it('keeps at least the target number of clues', () => {
        expect(clueCount(puzzle)).toBeGreaterThanOrEqual(clueTarget(puzzle.size, puzzle.difficulty))
        expect(clueCount(puzzle)).toBeLessThan(cellCount(puzzle.size))
      })

      it('admits exactly one solution', () => {
        expect(countSolutions(puzzle.givens, puzzle.size, 2)).toBe(1)
      })
    })
  }
})

describe('countSolutions', () => {
  it('finds the single completion of a solved board', () => {
    expect(countSolutions(PUZZLES.small.solution, 4)).toBe(1)
  })

  it('stops at the limit instead of enumerating an open board', () => {
    expect(countSolutions(emptyGrid(4), 4, 2)).toBe(2)
  })

  it('reports a contradictory board as unsolvable', () => {
    const grid = emptyGrid(4)
    grid[0] = 1
    grid[1] = 1
    expect(countSolutions(grid, 4, 2)).toBe(0)
  })
})
