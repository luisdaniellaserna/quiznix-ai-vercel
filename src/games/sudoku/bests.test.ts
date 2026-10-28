import { describe, expect, it, vi } from 'vitest'
import { SUDOKU_BESTS_KEY, bestKey, isBestKey, loadBests, recordSolve, saveBests } from './bests'

describe('bestKey', () => {
  it('names a board and difficulty', () => {
    expect(bestKey(9, 'hard')).toBe('9:hard')
    expect(bestKey(4, 'beginner')).toBe('4:beginner')
  })

  it('only accepts settings the app can deal', () => {
    expect(isBestKey('9:hard')).toBe(true)
    expect(isBestKey('4:beginner')).toBe(true)
    expect(isBestKey('4:hard')).toBe(false)
    expect(isBestKey('6:easy')).toBe(false)
    expect(isBestKey('nonsense')).toBe(false)
  })
})

describe('recordSolve', () => {
  it('claims the first solve as the best', () => {
    const { bests, isNewBest, best } = recordSolve({}, '9:easy', 90_000, 1)
    expect(isNewBest).toBe(true)
    expect(best).toEqual({ ms: 90_000, hints: 1 })
    expect(bests['9:easy']).toEqual({ ms: 90_000, hints: 1 })
  })

  it('beats a previous best by finishing faster', () => {
    const { isNewBest, best } = recordSolve(
      { '9:easy': { ms: 90_000, hints: 0 } },
      '9:easy',
      89_999,
      3,
    )
    expect(isNewBest).toBe(true)
    expect(best).toEqual({ ms: 89_999, hints: 3 })
  })

  it('breaks a time tie with fewer hints', () => {
    const { isNewBest } = recordSolve(
      { '9:medium': { ms: 60_000, hints: 2 } },
      '9:medium',
      60_000,
      1,
    )
    expect(isNewBest).toBe(true)
  })

  it('keeps the previous best on a tie or a slower solve', () => {
    const scored = { '9:medium': { ms: 60_000, hints: 1 } }
    expect(recordSolve(scored, '9:medium', 60_000, 1).isNewBest).toBe(false)
    expect(recordSolve(scored, '9:medium', 60_000, 2).isNewBest).toBe(false)
    expect(recordSolve(scored, '9:medium', 61_000, 0).isNewBest).toBe(false)
  })

  it('leaves other settings alone', () => {
    const scored = { '4:beginner': { ms: 12_000, hints: 0 }, '9:hard': { ms: 500_000, hints: 3 } }
    const { bests } = recordSolve(scored, '9:easy', 70_000, 1)
    expect(bests['4:beginner']).toEqual({ ms: 12_000, hints: 0 })
    expect(bests['9:hard']).toEqual({ ms: 500_000, hints: 3 })
    expect(bests['9:easy']).toEqual({ ms: 70_000, hints: 1 })
  })

  it('rejects nonsense results', () => {
    expect(() => recordSolve({}, '9:easy', -1, 0)).toThrow(RangeError)
    expect(() => recordSolve({}, '9:easy', Number.NaN, 0)).toThrow(RangeError)
    expect(() => recordSolve({}, '9:easy', 1_000, -1)).toThrow(RangeError)
    expect(() => recordSolve({}, '9:easy', 1_000, 1.5)).toThrow(RangeError)
  })
})

describe('bests persistence', () => {
  function stubStorage(seed?: string) {
    const store = new Map<string, string>()
    if (seed !== undefined) store.set(SUDOKU_BESTS_KEY, seed)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    return store
  }

  it('round-trips a best through storage', () => {
    const store = stubStorage()
    saveBests({ '9:hard': { ms: 420_000, hints: 2 } })
    expect(JSON.parse(store.get(SUDOKU_BESTS_KEY)!)).toEqual({
      '9:hard': { ms: 420_000, hints: 2 },
    })
    expect(loadBests()).toEqual({ '9:hard': { ms: 420_000, hints: 2 } })
    vi.unstubAllGlobals()
  })

  it('drops corrupt entries and survives unreadable storage', () => {
    stubStorage(
      '{"9:easy":{"ms":"fast","hints":0},"9:hard":{"ms":1000,"hints":1},"4:hard":{"ms":1,"hints":0},"nope":{"ms":1,"hints":0}}',
    )
    expect(loadBests()).toEqual({ '9:hard': { ms: 1000, hints: 1 } })
    vi.unstubAllGlobals()

    stubStorage('not json at all')
    expect(loadBests()).toEqual({})
    vi.unstubAllGlobals()
  })

  it('stays quiet when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadBests()).toEqual({})
    expect(() => saveBests({ '4:beginner': { ms: 1, hints: 0 } })).not.toThrow()
    vi.unstubAllGlobals()
  })
})
