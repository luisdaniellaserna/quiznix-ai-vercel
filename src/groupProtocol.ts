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

export interface ScoreboardEntry {
  playerId: string
  name: string
  /** points stored as milli-points (÷1000 for display) */
  score: number
  correct: number
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
      scoreboard: ScoreboardEntry[]
    }
  | { type: 'answer-updated'; playerId: string; name: string; option: string; correct: boolean }
  | { type: 'answer-progress'; answeredCount: number; totalPlayers: number }
  | { type: 'all-answered'; correctAnswer: string; scoreboard: ScoreboardEntry[] }
  | { type: 'game-finished'; leaderboard: LeaderboardEntry[] }
  | { type: 'room-resetting'; leaderboard: LeaderboardEntry[]; topic: string }
  | { type: 'room-to-lobby'; players: PlayerInfo[]; topic: string }
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
  | { type: 'rejoin'; code: string; playerId: string; name: string }
  | { type: 'rejoinHost'; code: string }
  | { type: 'start-game' }
  | { type: 'answer'; option: string }
  | { type: 'next-question' }
  | { type: 'restart-room' }
  | { type: 'back-to-lobby' }
  | {
      type: 'update-room-quiz'
      topic: string
      timerSeconds: number
      maxPlayers: number
      questions: QuestionFormat[]
    }
  | {
      type: 'start-next-game'
      topic: string
      timerSeconds: number
      maxPlayers: number
      questions: QuestionFormat[]
    }
  | { type: 'close-room' }
