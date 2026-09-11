import type { GroupClientMessage } from '../groupProtocol'

/** Phases of the group store state machine (mirrors GroupPhase in groupStore). */
export type ReconnectPhase =
  | 'idle'
  | 'connecting'
  | 'lobby'
  | 'starting'
  | 'question'
  | 'finished'
  | 'closed'

/** Persisted session shape used for the rejoin handshake (subset of loadSession). */
export interface StoredSession {
  code: string
  playerId: string | null
  playerName: string
  role: 'none' | 'host' | 'player'
  secret?: string
}

export type SocketState = 'open' | 'connecting' | 'down'

/** What send() must do with an outgoing message. */
export type SendDecision = 'send' | 'queue-redial' | 'queue' | 'close'

/** Phases in which a dropped socket must redial instead of giving up. */
export function isRecoverablePhase(phase: ReconnectPhase): boolean {
  return (
    phase === 'connecting' || phase === 'lobby' || phase === 'starting' || phase === 'question'
  )
}

/**
 * Pure send policy: a message tapped while the socket is down mid-game must
 * wait for the redial, never kill the session. The attempt budget bounds the
 * queueing so a dead server eventually surfaces as unreachable.
 */
export function decideSend(
  state: SocketState,
  shouldReconnect: boolean,
  phase: ReconnectPhase,
  reconnectAttempts: number,
  maxAttempts: number,
): SendDecision {
  if (state === 'open') return 'send'
  if (shouldReconnect && isRecoverablePhase(phase) && reconnectAttempts < maxAttempts) {
    return 'queue-redial'
  }
  if (state === 'connecting') return 'queue'
  return 'close'
}

/** Rejoin payload for a stored session, or null when there is nothing to resume. */
export function rejoinMessageFor(
  sess: StoredSession | null,
  shouldReconnect: boolean,
  fallbackName: string,
): GroupClientMessage | null {
  if (!sess || !sess.code || !shouldReconnect) return null
  if (sess.role === 'player' && sess.playerId) {
    return {
      type: 'rejoin',
      code: sess.code,
      playerId: sess.playerId,
      name: sess.playerName || fallbackName,
      secret: sess.secret,
    }
  }
  if (sess.role === 'host') {
    return { type: 'rejoinHost', code: sess.code, secret: sess.secret }
  }
  return null
}

/** Handshake messages — a queued one is stale once the burst re-attaches the socket. */
const HANDSHAKE_TYPES = new Set(['join', 'create-room', 'rejoin', 'rejoinHost'])

/**
 * Open-burst order: the rejoin precedes queued messages so answers tapped
 * during the outage land on a known slot. Queued handshakes are dropped when
 * the burst carries its own rejoin — a mirror-built duplicate would present
 * the same pre-rotation secret and fail verification after rotation.
 */
export function openBurst(
  rejoin: GroupClientMessage | null,
  queued: GroupClientMessage[],
): GroupClientMessage[] {
  const burst: GroupClientMessage[] = rejoin ? [rejoin] : []
  for (const message of queued) {
    if (rejoin && HANDSHAKE_TYPES.has(message.type)) continue
    burst.push(message)
  }
  return burst
}

/**
 * Whether a page load should automatically redial a stored session: only for
 * a live role, only for the room the loader expects (join link), and never
 * when another live tab already holds that room.
 */
export function shouldAutoResume(
  sess: StoredSession | null,
  expectedCode: string | undefined,
  blockingCode: string | null,
): boolean {
  if (!sess || !sess.code) return false
  if (sess.role !== 'host' && sess.role !== 'player') return false
  if (expectedCode && expectedCode !== sess.code) return false
  if (blockingCode && blockingCode === sess.code) return false
  return true
}
