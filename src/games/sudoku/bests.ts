/**
 * Personal bests for solo Sudoku, keyed by board and difficulty.
 * Best = fastest solve; using fewer hints breaks a tie.
 */

import { DIFFICULTIES, type Difficulty } from './generator'
import type { BoardSize } from './rules'

export interface SudokuBest {
  ms: number
  hints: number
}

export type SudokuBests = Record<string, SudokuBest>

export const SUDOKU_BESTS_KEY = 'quiznix-sudoku-bests'

export function bestKey(size: BoardSize, difficulty: Difficulty): string {
  return `${size}:${difficulty}`
}

export interface SolveOutcome {
  bests: SudokuBests
  best: SudokuBest
  isNewBest: boolean
}

export function recordSolve(
  bests: SudokuBests,
  key: string,
  ms: number,
  hints: number,
): SolveOutcome {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError('Solve time must be a non-negative number of milliseconds')
  }
  if (!Number.isInteger(hints) || hints < 0) {
    throw new RangeError('Hint count must be a non-negative integer')
  }

  const best: SudokuBest = { ms, hints }
  const previous = bests[key]
  const isNewBest = !previous || beats(best, previous)
  if (!isNewBest) return { bests, best: previous, isNewBest: false }
  return { bests: { ...bests, [key]: best }, best, isNewBest: true }
}

function beats(candidate: SudokuBest, incumbent: SudokuBest): boolean {
  if (candidate.ms !== incumbent.ms) return candidate.ms < incumbent.ms
  return candidate.hints < incumbent.hints
}

/** Whether `key` names a board and difficulty the app can actually deal. */
export function isBestKey(key: string): boolean {
  const [rawSize, difficulty] = key.split(':')
  const size = Number(rawSize)
  if (size !== 4 && size !== 9) return false
  return DIFFICULTIES[size].includes(difficulty as Difficulty)
}

export function loadBests(): SudokuBests {
  try {
    const raw = localStorage.getItem(SUDOKU_BESTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}

    const bests: SudokuBests = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isBestKey(key)) continue
      if (typeof value !== 'object' || value === null) continue
      const { ms, hints } = value as Partial<SudokuBest>
      if (!Number.isFinite(ms) || (ms as number) < 0) continue
      if (!Number.isInteger(hints) || (hints as number) < 0) continue
      bests[key] = { ms: ms as number, hints: hints as number }
    }
    return bests
  } catch {
    return {}
  }
}

export function saveBests(bests: SudokuBests): void {
  try {
    localStorage.setItem(SUDOKU_BESTS_KEY, JSON.stringify(bests))
  } catch {
    /* storage unavailable — the solve still counts for this session */
  }
}
