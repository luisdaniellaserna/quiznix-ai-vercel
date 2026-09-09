import type { GroupClientMessage } from '../groupProtocol'

/** Phases of the group store state machine (mirrors GroupPhase in groupStore). */
export type ReconnectPhase = 'idle' | 'connecting' | 'lobby' | 'question' | 'finished' | 'closed'

/** Persisted session shape used for auto-rejoin (mirrors loadSession in groupStore). */
export interface StoredSession {
  code: string
  playerId: string | null
  playerName: string
  role: 'none' | 'host' | 'player'
}

export type SocketState = 'open' | 'connecting' | 'down'

/** What send() must do with an outgoing message. */
export type SendDecision = 'send' | 'queue-redial' | 'queue' | 'close'

/** Phases in which a dropped socket must redial instead of giving up. */
function isRecoverablePhase(phase: ReconnectPhase): boolean {
  return phase === 'connecting' || phase === 'lobby' || phase === 'question'
}

/**
 * Pure send policy: a message tapped while the socket is down mid-game must
 * wait for the redial, never kill the session.
 */
export function decideSend(
  state: SocketState,
  shouldReconnect: boolean,
  phase: ReconnectPhase,
): SendDecision {
  if (state === 'open') return 'send'
  if (shouldReconnect && isRecoverablePhase(phase)) return 'queue-redial'
  if (state === 'connecting') return 'queue'
  return 'close'
}

/** Rejoin payload for a stored session, or null outside a live game. */
export function rejoinMessageFor(
  sess: StoredSession | null,
  phase: ReconnectPhase,
  fallbackName: string,
): GroupClientMessage | null {
  if (!sess || !sess.code) return null
  // only rejoin while still in a game that expects it
  if (!isRecoverablePhase(phase)) return null
  if (sess.role === 'player' && sess.playerId) {
    return { type: 'rejoin', code: sess.code, playerId: sess.playerId, name: sess.playerName || fallbackName }
  }
  if (sess.role === 'host') {
    return { type: 'rejoinHost', code: sess.code }
  }
  return null
}

/**
 * Open-burst order: the rejoin precedes queued messages so answers tapped
 * during the outage land on a known slot instead of being rejected.
 */
export function openBurst(
  rejoin: GroupClientMessage | null,
  queued: GroupClientMessage[],
): GroupClientMessage[] {
  return rejoin ? [rejoin, ...queued] : [...queued]
}
