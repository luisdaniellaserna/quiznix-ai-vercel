import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ChatMessage,
  GroupClientMessage,
  GroupServerMessage,
  HanoiStandingEntry,
  PlayerInfo,
} from '../groupProtocol'
import {
  claimActiveSession,
  evictOtherTab,
  getBlockingSession,
  onEvicted,
  randomId,
  releaseActiveSession,
} from './groupTabSync'
import type { SocketState } from './reconnectPolicy'
import { decideSend, isRecoverablePhase, shouldAutoResume } from './reconnectPolicy'
import type { Move } from '../../shared/hanoiRules.mjs'

export type HanoiRole = 'none' | 'host' | 'player'
export type HanoiPhase =
  | 'idle'
  | 'connecting'
  | 'lobby'
  | 'starting'
  | 'racing'
  | 'finished'
  | 'closed'
export type HanoiConnection = 'online' | 'reconnecting' | 'failed'

const GAME = 'hanoi' as const
const STORAGE_KEY = 'quiznix-group:hanoi'
const RESUME_TTL_FALLBACK_MS = 5 * 60 * 1000
const MAX_CHAT_MESSAGES = 100
const MAX_CHAT_LENGTH = 200
const MAX_PENDING = 50
const KEEPALIVE_MS = 20_000
const RECONNECT_WINDOW_MS = 90_000
const MAX_BACKOFF_MS = 10_000

/** The WebSocket URL of the room server, as configured or derived from the page host. */
export function hanoiRoomServerUrl() {
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (envUrl) return envUrl
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:8787`
}

function hanoiRoomServerOrigin() {
  return hanoiRoomServerUrl().replace(/^ws/, 'http')
}

interface StoredSession {
  code: string
  playerId: string | null
  playerName: string
  role: HanoiRole
  disks?: number
  /** player resume secret */
  secret?: string
  /** host resume secret (a race creator keeps both roles) */
  hostSecret?: string
  ttlMs?: number
  savedAt?: number
}

interface ResumeRecord {
  playerId: string | null
  name: string
  role: 'host' | 'player'
  secret: string
  hostSecret: string
  savedAt: number
  ttlMs: number
}

function resumeStorageKey(code: string) {
  return `quiznix-resume-${code.trim().toUpperCase()}`
}

/**
 * Tower of Hanoi race room. The creator opens a room and also takes a player
 * seat (host authority + a racer seat on one socket), so they race too. Players
 * join by code; once everyone is ready the server starts a shared countdown.
 * Each client solves locally and submits one validated move log at the finish.
 * Only finish events are broadcast — no board state is streamed.
 */
export const useHanoiRaceStore = defineStore('hanoiRace', () => {
  let socket: WebSocket | null = null
  let pending: GroupClientMessage[] = []
  let reconnectAttempts = 0
  let outageStartedAt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null
  let shouldReconnect = true

  const role = ref<HanoiRole>('none')
  const phase = ref<HanoiPhase>('idle')
  const roomCode = ref('')
  const playerId = ref<string | null>(null)
  const playerName = ref('')
  const players = ref<PlayerInfo[]>([])
  const disks = ref(4)
  const maxPlayers = ref(8)
  const standings = ref<HanoiStandingEntry[]>([])
  const startedAt = ref(0)
  const myStatus = ref<'finished' | 'dnf' | null>(null)
  const hostStatus = ref('waiting-to-start')
  const hostDetail = ref('')
  const hostOnline = ref(true)
  const hostOfflineExpiresAt = ref(0)
  const startingDeadline = ref<number | null>(null)
  const connection = ref<HanoiConnection>('online')
  const serverOffsetMs = ref(0)
  const chatMessages = ref<ChatMessage[]>([])
  const error = ref('')
  const errorCode = ref('')
  const closedMessage = ref('')
  const evictedMessage = ref('')
  const roomExpired = ref(false)

  const isHost = computed(() => role.value === 'host')
  const isPlayer = computed(() => role.value === 'player')
  const myReady = computed(() => {
    if (!playerId.value) return false
    return players.value.find((p) => p.playerId === playerId.value)?.ready ?? false
  })
  const readyCount = computed(() => players.value.filter((p) => p.ready).length)
  const allReady = computed(() => players.value.length > 0 && players.value.every((p) => p.ready))
  const canStart = computed(
    () => players.value.length >= 2 && allReady.value && phase.value === 'lobby',
  )
  const myStanding = computed(() =>
    standings.value.find((entry) => entry.playerId === playerId.value),
  )

  function activePhase() {
    return isRecoverablePhase(phase.value)
  }

  function socketState(): SocketState {
    if (!socket) return 'down'
    if (socket.readyState === WebSocket.OPEN) return 'open'
    if (socket.readyState === WebSocket.CONNECTING) return 'connecting'
    return 'down'
  }

  function withinReconnectWindow() {
    return outageStartedAt === 0 || Date.now() - outageStartedAt < RECONNECT_WINDOW_MS
  }

  function clearReconnectState() {
    reconnectAttempts = 0
    outageStartedAt = 0
  }

  function send(message: GroupClientMessage) {
    const decision = decideSend(socketState(), shouldReconnect, phase.value, withinReconnectWindow())
    if (decision === 'send') {
      socket?.send(JSON.stringify(message))
      return
    }
    if (decision === 'queue-redial' || decision === 'queue') {
      if (pending.length >= MAX_PENDING) pending.shift()
      pending.push(message)
      if (decision === 'queue-redial' && (!socket || socket.readyState === WebSocket.CLOSED)) {
        scheduleReconnect()
      }
      return
    }
    close(unreachableMessage())
  }

  function unreachableMessage() {
    return `Cannot reach the room server at ${hanoiRoomServerUrl()}. Start it with \`npm run dev:all\` (or \`npm run server\`), then try again.`
  }

  function loadSession(): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as StoredSession) : null
    } catch {
      return null
    }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }

  /** Merges seat secrets (a creator holds both a host and a player secret). */
  function saveSeat(partial: { hostSecret?: string; playerSecret?: string; ttlMs?: number }) {
    if (!roomCode.value) return
    if (role.value !== 'host' && role.value !== 'player') return
    const prev = loadSession()
    const record: StoredSession = {
      code: roomCode.value,
      playerId: playerId.value,
      playerName: playerName.value,
      role: role.value,
      disks: disks.value,
      secret: partial.playerSecret ?? prev?.secret ?? '',
      hostSecret: partial.hostSecret ?? prev?.hostSecret ?? '',
      ttlMs: partial.ttlMs ?? prev?.ttlMs ?? RESUME_TTL_FALLBACK_MS,
      savedAt: Date.now(),
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    } catch {
      /* ignore */
    }
    if (!record.secret && !record.hostSecret) return
    try {
      const mirror: ResumeRecord = {
        playerId: record.playerId,
        name: role.value === 'host' ? 'Host' : playerName.value,
        role: role.value,
        secret: record.secret ?? '',
        hostSecret: record.hostSecret ?? '',
        savedAt: record.savedAt ?? Date.now(),
        ttlMs: record.ttlMs ?? RESUME_TTL_FALLBACK_MS,
      }
      localStorage.setItem(resumeStorageKey(record.code), JSON.stringify(mirror))
    } catch {
      /* ignore */
    }
  }

  function clearResume(code?: string) {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
      const target = code ?? roomCode.value
      if (target) localStorage.removeItem(resumeStorageKey(target))
    } catch {
      /* ignore */
    }
  }

  /** Re-attaches every seat this session holds (host authority + player seat). */
  function rejoinBurst(): GroupClientMessage[] {
    const sess = loadSession()
    if (!sess || !sess.code || !shouldReconnect) return []
    const burst: GroupClientMessage[] = []
    if (sess.role === 'host' && sess.hostSecret) {
      burst.push({ type: 'rejoinHost', code: sess.code, secret: sess.hostSecret })
    }
    if (sess.playerId && sess.secret) {
      burst.push({
        type: 'rejoin',
        code: sess.code,
        playerId: sess.playerId,
        name: sess.playerName || playerName.value,
        secret: sess.secret,
      })
    }
    return burst
  }

  function chatStorageKey(code: string) {
    return `quiznix-chat-hanoi-${code}`
  }

  function loadChat(code: string) {
    chatMessages.value = []
    if (!code) return
    try {
      const raw = localStorage.getItem(chatStorageKey(code))
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        chatMessages.value = (parsed as ChatMessage[]).slice(-MAX_CHAT_MESSAGES)
      }
    } catch {
      /* ignore */
    }
  }

  function persistChat() {
    try {
      if (!roomCode.value) return
      localStorage.setItem(
        chatStorageKey(roomCode.value),
        JSON.stringify(chatMessages.value.slice(-MAX_CHAT_MESSAGES)),
      )
    } catch {
      /* ignore */
    }
  }

  function clearChat(code: string) {
    chatMessages.value = []
    if (!code) return
    try {
      localStorage.removeItem(chatStorageKey(code))
    } catch {
      /* ignore */
    }
  }

  function reset() {
    role.value = 'none'
    phase.value = 'idle'
    roomCode.value = ''
    playerId.value = null
    playerName.value = ''
    players.value = []
    standings.value = []
    startedAt.value = 0
    myStatus.value = null
    hostStatus.value = 'waiting-to-start'
    hostDetail.value = ''
    hostOnline.value = true
    hostOfflineExpiresAt.value = 0
    startingDeadline.value = null
    connection.value = 'online'
    serverOffsetMs.value = 0
    chatMessages.value = []
    error.value = ''
    errorCode.value = ''
    closedMessage.value = ''
    evictedMessage.value = ''
    roomExpired.value = false
  }

  function close(message: string) {
    shouldReconnect = false
    stopKeepalive()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    roomExpired.value = false
    clearResume()
    clearSession()
    releaseActiveSession(GAME)
    phase.value = 'closed'
    closedMessage.value = message
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (phase.value === 'finished' || phase.value === 'closed') return
    if (outageStartedAt === 0) outageStartedAt = Date.now()
    if (!withinReconnectWindow()) {
      connection.value = 'failed'
      return
    }
    connection.value = 'reconnecting'
    const base = 1000 * Math.pow(2, reconnectAttempts)
    const delay = Math.min(base, MAX_BACKOFF_MS) + Math.random() * 500
    reconnectAttempts++
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => connect(), delay)
  }

  function retryNow() {
    clearReconnectState()
    connection.value = 'reconnecting'
    connect()
  }

  let warmupInFlight = false
  function warmRoomServer() {
    if (warmupInFlight) return
    warmupInFlight = true
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), 8000)
    void fetch(`${hanoiRoomServerOrigin()}/healthz`, { cache: 'no-store', signal: controller.signal })
      .catch(() => {})
      .finally(() => {
        clearTimeout(abortTimer)
        warmupInFlight = false
      })
  }

  function startKeepalive() {
    stopKeepalive()
    keepaliveTimer = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN && activePhase()) {
        try {
          socket.send(JSON.stringify({ type: 'ping' }))
        } catch {
          /* ignore */
        }
      }
    }, KEEPALIVE_MS)
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
  }

  function connect() {
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    warmRoomServer()
    const ws = new WebSocket(hanoiRoomServerUrl())
    socket = ws
    ws.onopen = () => {
      if (ws !== socket) return
      clearReconnectState()
      connection.value = 'online'
      const burst = activePhase() ? rejoinBurst() : []
      for (const message of [...burst, ...pending.splice(0)]) {
        ws.send(JSON.stringify(message))
      }
    }
    ws.onmessage = (event) => {
      if (ws !== socket) return
      try {
        handle(JSON.parse(event.data) as GroupServerMessage)
      } catch (err) {
        console.error('[hanoi] dropping malformed message', err)
      }
    }
    ws.onerror = () => {
      if (ws === socket) ws.close()
    }
    ws.onclose = () => {
      if (ws !== socket) return
      stopKeepalive()
      if (!shouldReconnect || phase.value === 'finished' || phase.value === 'closed') {
        pending = []
        return
      }
      if (activePhase()) {
        scheduleReconnect()
        return
      }
      pending = []
      close(unreachableMessage())
    }
  }

  function handle(message: GroupServerMessage) {
    if (message.type !== 'pong') connection.value = 'online'
    switch (message.type) {
      case 'room-created':
        roomCode.value = message.code
        phase.value = 'lobby'
        roomExpired.value = false
        hostStatus.value = 'waiting-to-start'
        startingDeadline.value = null
        if (message.disks) disks.value = message.disks
        loadChat(message.code)
        if (message.hostSecret) saveSeat({ hostSecret: message.hostSecret })
        // the creator races too: take a player seat in the room they just made
        if (!playerId.value && playerName.value) {
          send({ type: 'join', code: message.code, name: playerName.value })
        }
        startKeepalive()
        break
      case 'joined':
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        roomExpired.value = false
        if (message.disks) disks.value = message.disks
        phase.value = 'lobby'
        loadChat(message.roomCode)
        if (message.resumeSecret) {
          saveSeat({ playerSecret: message.resumeSecret, ttlMs: message.resumeTtlMs })
        }
        startKeepalive()
        break
      case 'state-sync':
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        hostStatus.value = message.hostStatus
        hostDetail.value = message.hostDetail ?? ''
        hostOnline.value = message.hostOnline
        hostOfflineExpiresAt.value = message.hostOfflineExpiresAt ?? 0
        maxPlayers.value = message.maxPlayers
        startingDeadline.value =
          message.phase === 'starting' && message.countdownDeadline > 0
            ? message.countdownDeadline
            : null
        if (message.hanoi) {
          disks.value = message.hanoi.disks
          startedAt.value = message.hanoi.startedAt
          standings.value = message.hanoi.standings
          myStatus.value = message.hanoi.myResult?.status ?? null
        }
        error.value = ''
        phase.value = message.phase === 'question' ? 'lobby' : message.phase
        roomExpired.value = false
        loadChat(message.roomCode)
        if (message.hostSecret) saveSeat({ hostSecret: message.hostSecret })
        if (message.resumeSecret) {
          saveSeat({ playerSecret: message.resumeSecret, ttlMs: message.resumeTtlMs })
        }
        startKeepalive()
        break
      case 'pong':
        serverOffsetMs.value = message.serverNow - Date.now()
        break
      case 'host-disconnected':
        hostOnline.value = false
        hostOfflineExpiresAt.value = message.expiresAt
        break
      case 'lobby-updated':
        players.value = message.players
        break
      case 'host-status-updated':
        hostStatus.value = message.status
        hostDetail.value = message.detail ?? ''
        if (message.hostOnline !== undefined) {
          hostOnline.value = message.hostOnline
          if (message.hostOnline) hostOfflineExpiresAt.value = 0
          else if (message.hostOfflineExpiresAt)
            hostOfflineExpiresAt.value = message.hostOfflineExpiresAt
        }
        break
      case 'game-starting':
        startingDeadline.value = message.deadline
        hostStatus.value = 'countdown'
        phase.value = 'starting'
        error.value = ''
        break
      case 'game-start-cancelled':
        startingDeadline.value = null
        hostStatus.value = 'waiting-to-start'
        if (phase.value === 'starting') phase.value = 'lobby'
        break
      case 'kicked':
        close(message.message || 'You were removed by the host.')
        break
      case 'hanoi-started':
        disks.value = message.disks
        startedAt.value = message.startedAt
        standings.value = []
        myStatus.value = null
        startingDeadline.value = null
        hostStatus.value = 'started'
        phase.value = 'racing'
        error.value = ''
        break
      case 'hanoi-standings':
        standings.value = message.standings
        syncMyStatus()
        break
      case 'hanoi-finished':
        standings.value = message.standings
        syncMyStatus()
        phase.value = 'finished'
        break
      case 'room-to-lobby':
        players.value = message.players
        if (message.disks) disks.value = message.disks
        hostStatus.value = 'waiting-to-start'
        startingDeadline.value = null
        standings.value = []
        myStatus.value = null
        startedAt.value = 0
        roomExpired.value = false
        phase.value = 'lobby'
        break
      case 'chat-received': {
        if (chatMessages.value.some((m) => m.id === message.id)) break
        chatMessages.value = [
          ...chatMessages.value,
          {
            id: message.id,
            senderId: message.senderId,
            name: message.name,
            role: message.role,
            text: message.text,
            at: message.at,
          },
        ].slice(-MAX_CHAT_MESSAGES)
        persistChat()
        break
      }
      case 'game-closed':
        if (phase.value !== 'finished') close('The host ended the race.')
        break
      case 'host-left':
        close('The host left the race.')
        break
      case 'error': {
        if (role.value === 'host' && message.code === 'HOST_ALREADY_CONNECTED') {
          error.value = ''
          errorCode.value = ''
          if (phase.value === 'connecting') phase.value = 'idle'
          break
        }
        error.value = message.message
        errorCode.value = message.code ?? ''
        const gone = message.code === 'ROOM_NOT_FOUND' && roomCode.value !== ''
        if (phase.value === 'connecting') {
          phase.value = 'idle'
          if (gone) roomExpired.value = true
          break
        }
        if (gone) {
          roomExpired.value = true
          if (role.value === 'player') {
            close('Room closed (server restarted?). Ask the host for a new code.')
          }
        }
        break
      }
      default:
        break
    }
  }

  function syncMyStatus() {
    const mine = standings.value.find((entry) => entry.playerId === playerId.value)
    if (mine && mine.status !== 'pending') myStatus.value = mine.status
  }

  function createRoom(options: { disks: number; maxPlayers: number; name: string }) {
    reset()
    shouldReconnect = true
    clearReconnectState()
    role.value = 'host'
    phase.value = 'connecting'
    playerName.value = options.name
    disks.value = options.disks
    maxPlayers.value = options.maxPlayers
    claimActiveSession({ code: 'PENDING', role: 'host' }, GAME)
    connect()
    send({
      type: 'create-room',
      game: 'hanoi',
      disks: options.disks,
      maxPlayers: options.maxPlayers,
    })
  }

  function joinRoom(code: string, name: string) {
    reset()
    shouldReconnect = true
    clearReconnectState()
    role.value = 'player'
    phase.value = 'connecting'
    playerName.value = name
    const normalized = code.trim().toUpperCase()
    claimActiveSession({ code: normalized, role: 'player', playerName: name }, GAME)
    connect()
    send({ type: 'join', code: normalized, name })
  }

  function checkRoomConflict() {
    return getBlockingSession(GAME)
  }

  function forceTakeover(victimTabId: string) {
    evictOtherTab(victimTabId)
  }

  function updateSettings(disksValue: number, maxPlayersValue: number) {
    send({ type: 'update-hanoi', disks: disksValue, maxPlayers: maxPlayersValue })
  }

  function startRace() {
    error.value = ''
    send({ type: 'start-game' })
  }

  function cancelStart() {
    send({ type: 'cancel-start' })
  }

  function toggleReady(ready: boolean) {
    send({ type: 'toggle-ready', ready })
  }

  function kickPlayer(playerIdToKick: string) {
    send({ type: 'kick-player', playerId: playerIdToKick })
  }

  function finish(moves: Move[], hintsUsed: number) {
    send({ type: 'hanoi-finish', moves, hintsUsed })
  }

  function resign() {
    send({ type: 'hanoi-resign' })
  }

  function endRace() {
    send({ type: 'end-hanoi' })
  }

  function backToLobby() {
    send({ type: 'back-to-lobby' })
  }

  function sendChat(text: string) {
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH)
    if (!trimmed) return
    send({ type: 'chat', id: randomId(), text: trimmed })
  }

  function closeRoom() {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'close-room' }))
        return
      }
    } catch {
      /* ignore */
    }
    send({ type: 'close-room' })
  }

  function signalExit() {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'client-exit' }))
      }
    } catch {
      /* ignore */
    }
    try {
      const sess = loadSession()
      if (
        sess &&
        sess.code &&
        sess.playerId &&
        sess.secret &&
        typeof navigator !== 'undefined' &&
        typeof navigator.sendBeacon === 'function'
      ) {
        navigator.sendBeacon(
          `${hanoiRoomServerOrigin()}/leave`,
          JSON.stringify({ code: sess.code, playerId: sess.playerId, secret: sess.secret }),
        )
      }
    } catch {
      /* ignore */
    }
  }

  function leave() {
    // the creator owns the room: closing it frees every player at once
    if (role.value === 'host' && roomCode.value && phase.value !== 'closed') {
      closeRoom()
    }
    signalExit()
    shouldReconnect = false
    stopKeepalive()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = null
    }
    pending = []
    clearReconnectState()
    connection.value = 'online'
    clearResume()
    clearSession()
    releaseActiveSession(GAME)
    clearChat(roomCode.value)
    reset()
  }

  function resumeRoom(code: string, name: string) {
    reset()
    clearSession()
    shouldReconnect = true
    clearReconnectState()
    connection.value = 'reconnecting'
    role.value = 'player'
    phase.value = 'connecting'
    playerName.value = name
    const normalized = code.trim().toUpperCase()
    claimActiveSession({ code: normalized, role: 'player', playerName: name }, GAME)
    connect()
    const raw = localStorage.getItem(resumeStorageKey(normalized))
    const mirror = raw ? (JSON.parse(raw) as ResumeRecord) : null
    if (mirror) {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            code: normalized,
            playerId: mirror.playerId,
            playerName: name,
            role: 'player',
            secret: mirror.secret,
            hostSecret: mirror.hostSecret,
            ttlMs: mirror.ttlMs,
            savedAt: mirror.savedAt,
          } satisfies StoredSession),
        )
      } catch {
        /* ignore */
      }
    }
  }

  function autoResume(expectedCode?: string): boolean {
    if (phase.value !== 'idle') return false
    const sess = loadSession()
    if (!sess || !shouldAutoResume(sess, expectedCode, getBlockingSession(GAME)?.code ?? null)) {
      return false
    }
    if (sess.role !== 'host' && sess.role !== 'player') return false
    reset()
    shouldReconnect = true
    clearReconnectState()
    connection.value = 'reconnecting'
    role.value = sess.role
    phase.value = 'connecting'
    roomCode.value = sess.code
    playerId.value = sess.playerId
    playerName.value = sess.playerName ?? ''
    if (sess.disks) disks.value = sess.disks
    claimActiveSession(
      {
        code: sess.code,
        role: sess.role,
        playerName: sess.role === 'player' ? sess.playerName : undefined,
      },
      GAME,
    )
    connect()
    return true
  }

  onEvicted(() => {
    if (phase.value === 'idle' || phase.value === 'finished') return
    const previousRoom = roomCode.value
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = null
    }
    pending = []
    shouldReconnect = false
    clearResume()
    clearSession()
    releaseActiveSession(GAME)
    phase.value = 'closed'
    closedMessage.value = ''
    evictedMessage.value = previousRoom
      ? `You left Race ${previousRoom} because another tab took over.`
      : 'Another tab took over this race.'
  })

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && shouldReconnect && activePhase()) {
        if (connection.value === 'failed') retryNow()
        else connect()
      }
    })
    window.addEventListener('online', () => {
      if (shouldReconnect && activePhase()) {
        if (connection.value === 'failed') retryNow()
        else connect()
      }
    })
  }

  return {
    role,
    phase,
    roomCode,
    playerId,
    playerName,
    players,
    disks,
    maxPlayers,
    standings,
    startedAt,
    myStatus,
    hostStatus,
    hostDetail,
    hostOnline,
    hostOfflineExpiresAt,
    startingDeadline,
    connection,
    serverOffsetMs,
    chatMessages,
    error,
    errorCode,
    closedMessage,
    evictedMessage,
    roomExpired,
    isHost,
    isPlayer,
    myReady,
    readyCount,
    allReady,
    canStart,
    myStanding,
    createRoom,
    joinRoom,
    resumeRoom,
    autoResume,
    checkRoomConflict,
    forceTakeover,
    updateSettings,
    startRace,
    cancelStart,
    toggleReady,
    kickPlayer,
    finish,
    resign,
    endRace,
    backToLobby,
    sendChat,
    closeRoom,
    leave,
    retryNow,
  }
})
