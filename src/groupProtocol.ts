export interface PlayerInfo {
  playerId: string
  name: string
}

export interface LeaderboardEntry {
  name: string
  /** points stored as milli-points (÷1000 for display) so totals are ms-precise */
  score: number
  correct: number
  total: number
  timeSpentMs: number
}

export type GroupServerMessage =
  | { type: 'room-created'; code: string }
  | { type: 'joined'; playerId: string; name: string; roomCode: string; players: PlayerInfo[] }
  | { type: 'lobby-updated'; players: PlayerInfo[] }
  | {
      type: 'question-started'
      index: number
      total: number
      question: string
      options: string[]
      timerSeconds: number
      deadline: number
      correctAnswer: string
    }
  | { type: 'answer-updated'; playerId: string; name: string; option: string; correct: boolean }
  | { type: 'game-finished'; leaderboard: LeaderboardEntry[] }
  | { type: 'game-closed' }
  | { type: 'host-left' }
  | { type: 'error'; message: string }

export type GroupClientMessage =
  | {
      type: 'create-room'
      topic: string
      timerSeconds: number
      maxPlayers: number
      questions: QuestionFormat[]
    }
  | { type: 'join'; code: string; name: string }
  | { type: 'start-game' }
  | { type: 'answer'; option: string }
  | { type: 'next-question' }
  | { type: 'close-room' }
