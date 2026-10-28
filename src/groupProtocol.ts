import type { Move } from '../shared/hanoiRules.mjs'

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
  /** host syncs only — player syncs get the answer at reveal (all-answered) */
  correctAnswer?: string
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

export type HanoiStatus = 'finished' | 'dnf' | 'pending'

/** One seat in a Tower of Hanoi race's live or final standings. */
export interface HanoiStandingEntry {
  playerId: string
  name: string
  status: HanoiStatus
  rank: number
  finishedAt: number
  /** server-measured time from the race start; 0 until finished */
  elapsedMs: number
  moves: number
  hintsUsed: number
}

/** This seat's own recorded result in a race, if it has one. */
export interface HanoiResult {
  status: 'finished' | 'dnf'
  finishedAt: number
  moves: number
  hintsUsed: number
  name: string
}

/** Race payload carried by state-sync so a reconnecting racer hydrates at once. */
export interface HanoiSnapshot {
  disks: number
  startedAt: number
  standings: HanoiStandingEntry[]
  myResult: HanoiResult | null
}

export type GroupServerMessage =
  | { type: 'room-created'; code: string; hostSecret?: string; game?: 'hanoi'; disks?: number }
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
      game?: 'hanoi'
      disks?: number
    }
  | {
      type: 'state-sync'
      playerId: string | null
      roomCode: string
      phase: 'lobby' | 'starting' | 'question' | 'racing' | 'finished'
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
      game?: 'hanoi'
      hanoi?: HanoiSnapshot
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
      /** host copies only — players receive the answer at reveal (all-answered) */
      correctAnswer?: string
      scoreboard: ScoreboardEntry[]
    }
  | { type: 'answer-updated'; playerId: string; name: string; option: string; correct: boolean }
  | { type: 'answer-progress'; answeredCount: number; totalPlayers: number }
  | { type: 'all-answered'; correctAnswer: string; scoreboard: ScoreboardEntry[] }
  | { type: 'game-finished'; leaderboard: LeaderboardEntry[] }
  | { type: 'hanoi-started'; game: 'hanoi'; disks: number; startedAt: number }
  | { type: 'hanoi-standings'; standings: HanoiStandingEntry[] }
  | { type: 'hanoi-finished'; standings: HanoiStandingEntry[] }
  | {
      type: 'room-to-lobby'
      players: PlayerInfo[]
      topic: string
      quizReady: boolean
      game?: 'hanoi'
      disks?: number
    }
  | ({ type: 'chat-received' } & ChatMessage)
  | { type: 'game-closed' }
  | { type: 'host-left' }
  | { type: 'error'; message: string; code?: string }

export type GroupClientMessage =
  | {
      type: 'create-room'
      topic: string
      timerSeconds: number
      maxPlayers: number
      questions: QuestionFormat[]
    }
  | { type: 'create-room'; game: 'hanoi'; disks: number; maxPlayers: number }
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
  | { type: 'clear-room-quiz' }
  | {
      type: 'update-room-quiz'
      topic: string
      timerSeconds: number
      maxPlayers: number
      questions: QuestionFormat[]
    }
  | { type: 'hanoi-finish'; moves: Move[]; hintsUsed: number }
  | { type: 'hanoi-resign' }
  | { type: 'end-hanoi' }
  | { type: 'update-hanoi'; disks: number; maxPlayers: number }
  | { type: 'close-room' }
