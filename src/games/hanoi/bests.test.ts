import { describe, expect, it, vi } from 'vitest'
import { HANOI_BESTS_KEY, loadBests, recordSolve, saveBests } from './bests'

describe('recordSolve', () => {
  it('claims the first solve as the best', () => {
    const { bests, isNewBest, best } = recordSolve({}, 3, 9, 12_000)
    expect(isNewBest).toBe(true)
    expect(best).toEqual({ moves: 9, ms: 12_000 })
    expect(bests[3]).toEqual({ moves: 9, ms: 12_000 })
  })

  it('beats a previous best with fewer moves, however slow', () => {
    const { isNewBest, best } = recordSolve({ 4: { moves: 16, ms: 5_000 } }, 4, 15, 900_000)
    expect(isNewBest).toBe(true)
    expect(best).toEqual({ moves: 15, ms: 900_000 })
  })

  it('beats a previous best on time when the move count ties', () => {
    const { isNewBest } = recordSolve({ 4: { moves: 15, ms: 60_000 } }, 4, 15, 59_999)
    expect(isNewBest).toBe(true)
  })

  it('keeps the previous best on a tie or a slower solve', () => {
    const scored = { 4: { moves: 15, ms: 60_000 } }
    expect(recordSolve(scored, 4, 15, 60_000).isNewBest).toBe(false)
    expect(recordSolve(scored, 4, 15, 61_000).isNewBest).toBe(false)
    expect(recordSolve(scored, 4, 22, 1_000).isNewBest).toBe(false)
  })

  it('leaves other disk counts alone', () => {
    const scored = { 3: { moves: 7, ms: 9_000 }, 5: { moves: 31, ms: 90_000 } }
    const { bests } = recordSolve(scored, 4, 15, 30_000)
    expect(bests[3]).toEqual({ moves: 7, ms: 9_000 })
    expect(bests[5]).toEqual({ moves: 31, ms: 90_000 })
    expect(bests[4]).toEqual({ moves: 15, ms: 30_000 })
  })

  it('rejects nonsense results', () => {
    expect(() => recordSolve({}, 3, 0, 1_000)).toThrow(RangeError)
    expect(() => recordSolve({}, 3, 9, Number.NaN)).toThrow(RangeError)
  })
})

describe('bests persistence', () => {
  function stubStorage(seed?: string) {
    const store = new Map<string, string>()
    if (seed !== undefined) store.set(HANOI_BESTS_KEY, seed)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    return store
  }

  it('round-trips a best through storage', () => {
    const store = stubStorage()
    saveBests({ 5: { moves: 31, ms: 120_000 } })
    expect(JSON.parse(store.get(HANOI_BESTS_KEY)!)).toEqual({ 5: { moves: 31, ms: 120_000 } })
    expect(loadBests()).toEqual({ 5: { moves: 31, ms: 120_000 } })
    vi.unstubAllGlobals()
  })

  it('drops corrupt entries and survives unreadable storage', () => {
    stubStorage('{"3":{"moves":"lots"},"4":{"moves":15,"ms":1000},"nope":{"moves":1,"ms":1}}')
    expect(loadBests()).toEqual({ 4: { moves: 15, ms: 1000 } })
    vi.unstubAllGlobals()

    stubStorage('not json at all')
    expect(loadBests()).toEqual({})
    vi.unstubAllGlobals()
  })

  it('stays quiet when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadBests()).toEqual({})
    expect(() => saveBests({ 3: { moves: 7, ms: 1 } })).not.toThrow()
    vi.unstubAllGlobals()
  })
})
