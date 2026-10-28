import { candidates, cellCount, emptyCells, emptyGrid, type BoardSize, type Grid } from './rules'

export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard'

export interface Puzzle {
  size: BoardSize
  difficulty: Difficulty
  /** The starting board: clues only, `0` where the player fills in. */
  givens: Grid
  /** The single completion `givens` admits. */
  solution: Grid
  seed: number
}

export const DIFFICULTIES: Record<BoardSize, Difficulty[]> = {
  4: ['beginner'],
  9: ['easy', 'medium', 'hard'],
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: 'Beginner',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

/**
 * Clues a puzzle aims to keep. Removal stops as soon as dropping another clue
 * would allow a second solution, so the real count is this or a little higher.
 */
const CLUE_TARGETS: Record<BoardSize, Partial<Record<Difficulty, number>>> = {
  4: { beginner: 8 },
  9: { easy: 40, medium: 32, hard: 26 },
}

/** Small, fast, seeded PRNG — the same seed always yields the same puzzle. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function clueTarget(size: BoardSize, difficulty: Difficulty): number {
  if (!DIFFICULTIES[size].includes(difficulty)) {
    throw new RangeError(`${difficulty} is not a ${size}×${size} difficulty`)
  }
  return CLUE_TARGETS[size][difficulty] as number
}

/**
 * Builds a puzzle in three passes: a randomly filled grid, then a single sweep
 * that drops clues while the puzzle still has exactly one solution. The sweep is
 * what guarantees the puzzle is solvable *and* honest — no guesswork needed.
 */
export function generatePuzzle(options: {
  size: BoardSize
  difficulty: Difficulty
  seed?: number
}): Puzzle {
  const { size, difficulty } = options
  const target = clueTarget(size, difficulty)
  const seed = options.seed ?? Math.floor(Math.random() * 0x1_0000_0000)

  const random = mulberry32(seed)
  const solution = fillGrid(size, random)
  const givens = solution.slice()
  let clues = cellCount(size)

  for (const index of shuffle(range(cellCount(size)), random)) {
    if (clues <= target) break
    const digit = givens[index]
    if (!digit) continue

    givens[index] = 0
    if (countSolutions(givens, size, 2) === 1) clues -= 1
    else givens[index] = digit
  }

  return { size, difficulty, givens, solution, seed }
}

/** Counts solutions, stopping once `limit` is reached. */
export function countSolutions(grid: Grid, size: BoardSize, limit = 2): number {
  return countFrom(grid.slice(), size, limit)
}

function countFrom(grid: Grid, size: BoardSize, limit: number): number {
  // most-constrained cell first: the fewest dead ends, so a uniqueness check on a
  // nearly full board stays in the low milliseconds
  let pivot = -1
  let options: number[] | null = null
  for (let index = 0; index < grid.length; index++) {
    if (grid[index]) continue
    const available = candidates(grid, size, index)
    if (available.length === 0) return 0
    if (!options || available.length < options.length) {
      pivot = index
      options = available
      if (available.length === 1) break
    }
  }

  if (!options) return 1

  let found = 0
  for (const digit of options) {
    grid[pivot] = digit
    found += countFrom(grid, size, limit - found)
    grid[pivot] = 0
    if (found >= limit) break
  }
  return found
}

function fillGrid(size: BoardSize, random: () => number): Grid {
  const grid = emptyGrid(size)
  fillFrom(grid, size, random)
  return grid
}

function fillFrom(grid: Grid, size: BoardSize, random: () => number): boolean {
  const [index] = emptyCells(grid)
  if (index === undefined) return true

  for (const digit of shuffle(candidates(grid, size, index), random)) {
    grid[index] = digit
    if (fillFrom(grid, size, random)) return true
    grid[index] = 0
  }
  return false
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index)
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice()
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}
