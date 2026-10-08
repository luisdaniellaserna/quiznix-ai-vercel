/**
 * Personal bests for solo Tower of Hanoi, keyed by disk count.
 * Best = fewest moves, tie-broken by the fastest solve.
 */

export interface HanoiBest {
  moves: number
  ms: number
}

export type HanoiBests = Record<number, HanoiBest>

export const HANOI_BESTS_KEY = 'quiznix-hanoi-bests'

export interface SolveOutcome {
  bests: HanoiBests
  best: HanoiBest
  isNewBest: boolean
}

export function recordSolve(
  bests: HanoiBests,
  disks: number,
  moves: number,
  ms: number,
): SolveOutcome {
  if (!Number.isInteger(moves) || moves <= 0) {
    throw new RangeError('Move count must be a positive integer')
  }
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError('Solve time must be a non-negative number of milliseconds')
  }
  const best: HanoiBest = { moves, ms }
  const previous = bests[disks]
  const isNewBest = !previous || beats(best, previous)
  if (!isNewBest) return { bests, best: previous, isNewBest: false }
  return { bests: { ...bests, [disks]: best }, best, isNewBest: true }
}

function beats(candidate: HanoiBest, incumbent: HanoiBest): boolean {
  if (candidate.moves !== incumbent.moves) return candidate.moves < incumbent.moves
  return candidate.ms < incumbent.ms
}

export function loadBests(): HanoiBests {
  try {
    const raw = localStorage.getItem(HANOI_BESTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const bests: HanoiBests = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const disks = Number(key)
      if (!Number.isInteger(disks) || disks <= 0) continue
      if (typeof value !== 'object' || value === null) continue
      const { moves, ms } = value as Partial<HanoiBest>
      if (!Number.isInteger(moves) || (moves as number) <= 0) continue
      if (!Number.isFinite(ms) || (ms as number) < 0) continue
      bests[disks] = { moves: moves as number, ms: ms as number }
    }
    return bests
  } catch {
    return {}
  }
}

export function saveBests(bests: HanoiBests): void {
  try {
    localStorage.setItem(HANOI_BESTS_KEY, JSON.stringify(bests))
  } catch {
    /* storage unavailable — the solve still counts for this session */
  }
}
