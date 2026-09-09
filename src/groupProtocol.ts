export type HostStatus =
  | 'choosing-topic'
  | 'generating'
  | 'waiting-to-start'
  | 'countdown'
  | 'started'

export interface PlayerInfo {
  playerId: string
  name: string
  ready: boolean
  connected: boolean
  /** absolute server expiry (ms epoch) for offline seats; null while connected */
  expiresAt: number | null
}

export interface StateSyncQuestion {
  index: number
  total: number
  question: string
  options: string[]
  timerSeconds: number
  deadline: number
  correctAnswer: string
  scoreboard: ScoreboardEntry[]
  /** this seat's locked answer for the current question, if any */
  myAnswer: string | null
}

export interface LeaderboardEntry {
  name: string
  /** points stored as milli-points (÷1000 for display) so totals are ms-precise */
  score: number
  correct: number
  total: number
  timeSpentMs: number
}

export interface ChatMessage {
  id: string
  senderId: string
  name: string
  role: 'host' | 'player'
  text: string
  /** server timestamp (ms) so every client orders history the same way */
  at: number
}

export interface ScoreboardEntry {
  playerId: string
  name: string
  /** points stored as milli-points (÷1000 for display) */
  score: number
  correct: number
}

export type GroupServerMessage =
  | { type: 'room-created'; code: string; hostSecret?: string }
  | {
      type: 'joined'
      playerId: string
      name: string
      roomCode: string
      players: PlayerInfo[]
      quizReady: boolean
      hostStatus: HostStatus
      hostDetail?: string
      resumeSecret?: string
      resumeTtlMs?: number
    }
  | {
      type: 'state-sync'
      playerId: string | null
      roomCode: string
      phase: 'lobby' | 'starting' | 'question' | 'finished'
      players: PlayerInfo[]
      quizReady: boolean
      hostStatus: HostStatus
      hostDetail: string
      hostOnline: boolean
      hostOfflineExpiresAt: number
      topic: string
      timerSeconds: number
      maxPlayers: number
      countdownDeadline: number
      question: StateSyncQuestion | null
      leaderboard: LeaderboardEntry[] | null
      resumeSecret?: string
      resumeTtlMs?: number
      hostSecret?: string
      serverNow: number
    }
  | { type: 'pong'; serverNow: number }
  | { type: 'host-disconnected'; expiresAt: number }
  | { type: 'lobby-updated'; players: PlayerInfo[]; quizReady: boolean }
  | {
      type: 'host-status-updated'
      status: HostStatus
      detail?: string
      topic?: string
      hostOnline?: boolean
      hostOfflineExpiresAt?: number
    }
  | { type: 'game-starting'; deadline: number; countdownSeconds: number }
  | { type: 'game-start-cancelled' }
  | { type: 'kicked'; message: string }
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
  | { type: 'room-to-lobby'; players: PlayerInfo[]; topic: string; quizReady: boolean }
  | ({ type: 'chat-received' } & ChatMessage)
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
  | { type: 'rejoin'; code: string; playerId: string; name: string; secret?: string }
  | { type: 'rejoinHost'; code: string; secret?: string }
  | { type: 'ping' }
  | { type: 'client-exit' }
  | { type: 'start-game' }
  | { type: 'cancel-start' }
  | { type: 'toggle-ready'; ready: boolean }
  | { type: 'kick-player'; playerId: string }
  | { type: 'host-status'; status: HostStatus; detail?: string }
  | { type: 'answer'; option: string }
  | { type: 'chat'; id: string; text: string }
  | { type: 'next-question' }
  | { type: 'back-to-lobby' }
  | {
      type: 'update-room-quiz'
      topic: string
      timerSeconds: number
      maxPlayers: number
      questions: QuestionFormat[]
    }
  | { type: 'close-room' }
