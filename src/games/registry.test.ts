import { describe, expect, it } from 'vitest'
import { GAMES, findGame, isPlayable } from './registry'

describe('the game registry', () => {
  it('lists at least one game', () => {
    expect(GAMES.length).toBeGreaterThan(0)
  })

  it('gives every game a unique id and route, so the dashboard and router cannot collide', () => {
    const ids = GAMES.map((game) => game.id)
    const paths = GAMES.map((game) => game.path)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('describes every game enough for a card', () => {
    for (const game of GAMES) {
      expect(game.name.trim()).not.toBe('')
      expect(game.tagline.trim()).not.toBe('')
      expect(game.icon.trim()).not.toBe('')
      expect(game.path.startsWith('/')).toBe(true)
      expect(game.modes.length).toBeGreaterThan(0)
      expect(typeof game.load).toBe('function')
    }
  })

  it('keeps every id resolvable', () => {
    for (const game of GAMES) expect(findGame(game.id)).toBe(game)
    expect(findGame('nope')).toBeUndefined()
  })
})

describe('isPlayable', () => {
  const needsAi = { requiresAi: true } as (typeof GAMES)[number]
  const offline = { requiresAi: false } as (typeof GAMES)[number]

  it('blocks an AI game when the key is missing, and allows it once present', () => {
    expect(isPlayable(needsAi, false)).toBe(false)
    expect(isPlayable(needsAi, true)).toBe(true)
  })

  it('never blocks a game that does not need the AI key', () => {
    expect(isPlayable(offline, false)).toBe(true)
    expect(isPlayable({} as (typeof GAMES)[number], false)).toBe(true)
  })
})
