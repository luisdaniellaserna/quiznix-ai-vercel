import type { Component } from 'vue'

export type GameMode = 'solo' | 'group'

/**
 * One entry per playable game. Everything game-facing — the dashboard grid, the
 * navigation, the help entry — reads this list, so adding a game is one folder
 * plus one entry here rather than another branch in the shell.
 */
export interface GameDefinition {
  id: string
  /** Shown on the card and in the header. */
  name: string
  tagline: string
  /** Card art. Emoji, matching the app's playful card style. */
  icon: string
  path: string
  modes: GameMode[]
  /** Cannot be played at all without the AI key configured. */
  requiresAi?: boolean
  load: () => Promise<Component>
}

export const GAMES: GameDefinition[] = [
  {
    id: 'quiz',
    name: 'Quiznix AI',
    tagline: 'Turn any topic into a quiz — solo, or live against friends.',
    icon: '📝',
    path: '/quiz',
    modes: ['solo', 'group'],
    requiresAi: true,
    load: () => import('./quiz/QuizFlow.vue'),
  },
  {
    id: 'hanoi',
    name: 'Tower of Hanoi',
    tagline: 'Stack every disk and chase your best solve.',
    icon: '🗼',
    path: '/hanoi',
    modes: ['solo'],
    load: () => import('./hanoi/HanoiFlow.vue'),
  },
]

/** A game is playable unless it needs the AI key and the key is missing. */
export function isPlayable(game: GameDefinition, hasAiKey: boolean): boolean {
  return !game.requiresAi || hasAiKey
}

export function findGame(id: string): GameDefinition | undefined {
  return GAMES.find((game) => game.id === id)
}
