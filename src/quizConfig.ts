export type Mode = 'easy' | 'medium' | 'hard'

export type GameMode = 'solo' | 'group'

export interface ModeConfig {
  label: string
  timerSeconds: number
  difficulty: string
}

export const MODE_CONFIG: Record<Mode, ModeConfig> = {
  easy: { label: 'Easy', timerSeconds: 15, difficulty: 'Easy' },
  medium: { label: 'Medium', timerSeconds: 25, difficulty: 'Medium' },
  hard: { label: 'Hard', timerSeconds: 40, difficulty: 'Hard' },
}
