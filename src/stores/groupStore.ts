import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  ChatMessage,
  GroupClientMessage,
  GroupServerMessage,
  LeaderboardEntry,
  PlayerInfo,
  ScoreboardEntry,
} from '../groupProtocol'
import {
  claimActiveSession,
  evictOtherTab,
  getBlockingSession,
  onEvicted,
  releaseActiveSession,
} from './groupTabSync'

export type GroupRole = 'none' | 'host' | 'player'
export type GroupPhase =
  | 'idle'
  | 'connecting'
  | 'lobby'
  | 'starting'
  | 'question'
  | 'finished'
  | 'closed'
export type ConnectionState = 'online' | 'reconnecting' | 'failed'
export interface ResumeOffer {
  code: string
  name: string
  role: 'host' | 'player'
  savedAt: number
}
export type HostStatus =
  | 'choosing-topic'
  | 'generating'
  | 'waiting-to-start'
  | 'countdown'
  | 'started'

/** The WebSocket URL of the room server, as configured or derived from the page host. */
export function roomServerUrl() {
  const envUrl = import.meta.env.VITE_WS_URL as string | undefined
  if (envUrl) {
    return envUrl
  }
  // ws:// is blocked from https:// pages (mixed content) — use wss:// when the page is https
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:8787`
}

/** The HTTP origin of the room server (for endpoints like /lan). */
export function roomServerOrigin() {
  return roomServerUrl().replace(/^ws/, 'http')
}

export const useGroupStore = defineStore('group', () => {
  let socket: WebSocket | null = null
  let pending: GroupClientMessage[] = []
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let shouldReconnect = true

  const role = ref<GroupRole>('none')
  const phase = ref<GroupPhase>('idle')
  const roomCode = ref('')
  const maxPlayers = ref(10)
  const topic = ref('')
  const playerId = ref<string | null>(null)
  const playerName = ref('')
  const players = ref<PlayerInfo[]>([])
  const currentIndex = ref(0)
  const total = ref(0)
  const question = ref('')
  const options = ref<string[]>([])
  const timerSeconds = ref(0)
  const deadline = ref<number | null>(null)
  const correctAnswer = ref('')
  const myAnswer = ref<string | null>(null)
  const allAnswered = ref(false)
  const hostQuestions = ref<QuestionFormat[]>([])
  const liveAnswers = ref<Record<string, { name: string; option: string; correct: boolean }>>({})
  const scoreboard = ref<ScoreboardEntry[]>([])
  const answeredCount = ref(0)
  const totalPlayers = ref(0)
  const leaderboard = ref<LeaderboardEntry[] | null>(null)
  const quizReady = ref(true)
  const hostStatus = ref<HostStatus>('waiting-to-start')
  const hostDetail = ref('')
  const hostOnline = ref(true)
  const hostOfflineExpiresAt = ref(0)
  const startingDeadline = ref<number | null>(null)
  const connection = ref<ConnectionState>('online')
  const serverOffsetMs = ref(0)
  const myReady = computed(() => {
    if (!playerId.value) return false
    return players.value.find((p) => p.playerId === playerId.value)?.ready ?? false
  })
  const readyCount = computed(() => players.value.filter((p) => p.ready).length)
  const allReady = computed(() => players.value.length > 0 && players.value.every((p) => p.ready))
  // Lobby group chat. The server only relays messages — every client keeps its
  // own copy in localStorage so a refresh restores the visible history.
  const chatMessages = ref<ChatMessage[]>([])
  const closedMessage = ref('')
  const error = ref('')
  const evictedMessage = ref('')

  const STORAGE_KEY = 'quiznix-group'
  const RESUME_TTL_FALLBACK_MS = 5 * 60 * 1000
  const MAX_CHAT_MESSAGES = 100
  const MAX_CHAT_LENGTH = 200
  const KEEPALIVE_MS = 20_000
  const MAX_RECONNECT_ATTEMPTS = 5

  function resumeStorageKey(code: string) {
    return `quiznix-resume-${code.trim().toUpperCase()}`
  }

  interface ResumeRecord {
    playerId: string | null
    name: string
    role: 'host' | 'player'
    secret: string
    savedAt: number
    ttlMs: number
  }

  /** Crash-proof mirror of the seat secret (sessionStorage dies with the tab). */
  function saveSeat(secret: string, ttlMs: number) {
    if (!roomCode.value || !secret) return
    const r = role.value
    if (r !== 'host' && r !== 'player') return
    persistSession(secret, ttlMs)
    try {
      const mirror: ResumeRecord = {
        playerId: playerId.value,
        name: r === 'host' ? 'Host' : playerName.value,
        role: r,
        secret,
        savedAt: Date.now(),
        ttlMs: ttlMs > 0 ? ttlMs : RESUME_TTL_FALLBACK_MS,
      }
      localStorage.setItem(resumeStorageKey(roomCode.value), JSON.stringify(mirror))
    } catch {}
  }

  function clearResume(code?: string) {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
      const target = code ?? roomCode.value
      if (target) localStorage.removeItem(resumeStorageKey(target))
    } catch {}
  }

  function loadResumeRecord(): (ResumeRecord & { code: string }) | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as ResumeRecord & { code: string }
        if (parsed.code && parsed.secret) return parsed
      }
    } catch {}
    return null
  }

  function resumeFresh(record: { savedAt: number; ttlMs: number }) {
    return Date.now() - record.savedAt < (record.ttlMs > 0 ? record.ttlMs : RESUME_TTL_FALLBACK_MS)
  }

  /** One-tap "Resume as Ana?" offer for the join screens. Null when stale/absent. */
  function getResumeOffer(code?: string): ResumeOffer | null {
    try {
      const keys: string[] = []
      if (code) {
        keys.push(resumeStorageKey(code))
      } else {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && key.startsWith('quiznix-resume-')) keys.push(key)
        }
      }
      let best: (ResumeRecord & { code: string }) | null = null
      for (const key of keys) {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw) as ResumeRecord
          if (!parsed.secret || !resumeFresh(parsed)) {
            try {
              localStorage.removeItem(key)
            } catch {}
            continue
          }
          const record = { ...parsed, code: key.slice('quiznix-resume-'.length) }
          if (!best || record.savedAt > best.savedAt) best = record
        } catch {}
      }
      if (!best) return null
      return { code: best.code, name: best.name, role: best.role, savedAt: best.savedAt }
    } catch {
      return null
    }
  }

  function discardResume(code: string) {
    try {
      localStorage.removeItem(resumeStorageKey(code))
    } catch {}
    const sess = loadResumeRecord()
    if (sess && sess.code === code.trim().toUpperCase()) clearResume(code)
  }

  function chatStorageKey(code: string) {
    return `quiznix-chat-${code}`
  }

  function isChatMessage(value: unknown): value is ChatMessage {
    if (typeof value !== 'object' || value === null) return false
    const m = value as Record<string, unknown>
    return (
      typeof m.id === 'string' &&
      typeof m.senderId === 'string' &&
      typeof m.name === 'string' &&
      (m.role === 'host' || m.role === 'player') &&
      typeof m.text === 'string' &&
      typeof m.at === 'number'
    )
  }

  function loadChat(code: string) {
    chatMessages.value = []
    if (!code) return
    try {
      const raw = localStorage.getItem(chatStorageKey(code))
      if (!raw) return
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        chatMessages.value = parsed.filter(isChatMessage).slice(-MAX_CHAT_MESSAGES)
      }
    } catch {}
  }

  function persistChat() {
    try {
      if (!roomCode.value) return
      localStorage.setItem(
        chatStorageKey(roomCode.value),
        JSON.stringify(chatMessages.value.slice(-MAX_CHAT_MESSAGES)),
      )
    } catch {}
  }

  function clearChat(code: string) {
    chatMessages.value = []
    if (!code) return
    try {
      localStorage.removeItem(chatStorageKey(code))
    } catch {}
  }

  // Position of this player in the latest scoreboard (1-based), or 0 if not on it.
  const myRank = computed(() => {
    if (!playerId.value) return 0
    const idx = scoreboard.value.findIndex((entry) => entry.playerId === playerId.value)
    return idx === -1 ? 0 : idx + 1
  })

  function persistSession(secret?: string, ttlMs?: number) {
    try {
      const prev = loadSession()
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          code: roomCode.value,
          playerId: playerId.value,
          playerName: playerName.value,
          role: role.value,
          topic: topic.value,
          hostQuestions: hostQuestions.value,
          maxPlayers: maxPlayers.value,
          secret: secret ?? prev?.secret ?? '',
          ttlMs: ttlMs ?? prev?.ttlMs ?? RESUME_TTL_FALLBACK_MS,
          savedAt: Date.now(),
        }),
      )
    } catch {}
  }
  function clearSession() {
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }
  function loadSession(): {
    code: string
    playerId: string | null
    playerName: string
    role: GroupRole
    secret?: string
    ttlMs?: number
  } | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const UNREACHABLE_MESSAGE = `Cannot reach the room server at ${roomServerUrl()}. Start it with \`npm run dev:all\` (or \`npm run server\`), then try again.`

  function activePhase() {
    return (
      phase.value === 'connecting' ||
      phase.value === 'lobby' ||
      phase.value === 'starting' ||
      phase.value === 'question'
    )
  }

  function send(message: GroupClientMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
      return
    }
    // Never kill the session on a transient blip caused by a user tap: queue
    // lobby intent and flush it after the rejoin handshake completes.
    if (shouldReconnect && activePhase() && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      pending.push(message)
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        scheduleReconnect()
      }
      return
    }
    close(UNREACHABLE_MESSAGE)
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (phase.value === 'finished' || phase.value === 'closed') return
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      connection.value = 'failed'
      return
    }
    connection.value = 'reconnecting'
    const base = 1000 * Math.pow(2, reconnectAttempts)
    const delay = Math.min(base, 30000) + Math.random() * 500
    console.log(
      `[group] disconnected — reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts + 1})`,
    )
    reconnectAttempts++
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => connect(), delay)
  }

  /** Manual retry from the reconnect banner (resets the attempt budget). */
  function retryNow() {
    reconnectAttempts = 0
    connection.value = 'reconnecting'
    connect()
  }

  function rejoinMessage(): GroupClientMessage | null {
    const sess = loadSession()
    if (!sess || !sess.code || !shouldReconnect) return null
    if (sess.role === 'player' && sess.playerId) {
      return {
        type: 'rejoin',
        code: sess.code,
        playerId: sess.playerId,
        name: sess.playerName || playerName.value,
        secret: sess.secret,
      }
    }
    if (sess.role === 'host') {
      return { type: 'rejoinHost', code: sess.code, secret: sess.secret }
    }
    return null
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
    socket = new WebSocket(roomServerUrl())
    socket.onopen = () => {
      console.log('[group] connected')
      reconnectAttempts = 0
      connection.value = 'online'
      // Rejoin FIRST so the server knows this socket; only then flush actions
      // the user queued while offline (otherwise they fail as a stranger).
      const rejoin = activePhase() ? rejoinMessage() : null
      if (rejoin) {
        socket?.send(JSON.stringify(rejoin))
      }
      const queued = pending.splice(0)
      for (const message of queued) {
        // join/create carry their own handshake — never replay a stale one
        // after a rejoin already re-attached this socket.
        if (rejoin && (message.type === 'join' || message.type === 'create-room')) continue
        socket?.send(JSON.stringify(message))
      }
    }
    socket.onmessage = (event) => handle(JSON.parse(event.data) as GroupServerMessage)
    socket.onerror = () => {
      // triggers onclose — let the close handler decide to reconnect
      socket?.close()
    }
    socket.onclose = () => {
      stopKeepalive()
      // if we intentionally left (leave/closeRoom) or game finished, do not reconnect
      if (!shouldReconnect || phase.value === 'finished' || phase.value === 'closed') {
        pending = []
        return
      }
      // transient drop while in lobby/question/connecting — keep pending for retry
      // and try to re-establish with exponential backoff instead of immediately showing unreachable
      if (activePhase()) {
        scheduleReconnect()
        return
      }
      pending = []
      close(UNREACHABLE_MESSAGE)
    }
  }

  let keepaliveTimer: ReturnType<typeof setInterval> | null = null

  function startKeepalive() {
    stopKeepalive()
    keepaliveTimer = setInterval(() => {
      if (
        socket &&
        socket.readyState === WebSocket.OPEN &&
        (phase.value === 'lobby' || phase.value === 'starting' || phase.value === 'question')
      ) {
        try {
          socket.send(JSON.stringify({ type: 'ping' }))
        } catch {}
      }
    }, KEEPALIVE_MS)
  }

  function stopKeepalive() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer)
      keepaliveTimer = null
    }
  }

  function handle(message: GroupServerMessage) {
    if (message.type !== 'pong') {
      connection.value = 'online'
    }
    switch (message.type) {
      case 'room-created':
        roomCode.value = message.code
        phase.value = 'lobby'
        quizReady.value = true
        hostStatus.value = 'waiting-to-start'
        hostDetail.value = ''
        hostOnline.value = true
        hostOfflineExpiresAt.value = 0
        startingDeadline.value = null
        loadChat(message.code)
        persistSession()
        if (message.hostSecret) {
          saveSeat(message.hostSecret, RESUME_TTL_FALLBACK_MS)
        }
        startKeepalive()
        break
      case 'joined':
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        quizReady.value = message.quizReady ?? true
        hostStatus.value = message.hostStatus ?? 'waiting-to-start'
        hostDetail.value = message.hostDetail ?? ''
        phase.value = 'lobby'
        loadChat(message.roomCode)
        persistSession()
        if (message.resumeSecret) {
          saveSeat(message.resumeSecret, message.resumeTtlMs ?? RESUME_TTL_FALLBACK_MS)
        }
        startKeepalive()
        break
      case 'state-sync': {
        // atomic hydrate: apply the whole snapshot before any phase switch so
        // a mid-game returner never renders a half-synced room
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        quizReady.value = message.quizReady
        hostStatus.value = message.hostStatus
        hostDetail.value = message.hostDetail ?? ''
        hostOnline.value = message.hostOnline
        hostOfflineExpiresAt.value = message.hostOfflineExpiresAt ?? 0
        topic.value = message.topic
        timerSeconds.value = message.timerSeconds
        maxPlayers.value = message.maxPlayers
        startingDeadline.value =
          message.phase === 'starting' && message.countdownDeadline > 0
            ? message.countdownDeadline
            : null
        if (message.question) {
          const q = message.question
          currentIndex.value = q.index
          total.value = q.total
          question.value = q.question
          options.value = q.options
          timerSeconds.value = q.timerSeconds
          deadline.value = q.deadline
          correctAnswer.value = q.correctAnswer
          myAnswer.value = q.myAnswer
          allAnswered.value = false
          liveAnswers.value = {}
          scoreboard.value = q.scoreboard ?? []
          answeredCount.value = 0
          totalPlayers.value = q.scoreboard?.length ?? players.value.length
        } else {
          myAnswer.value = null
          allAnswered.value = false
          liveAnswers.value = {}
          if (message.phase !== 'question') {
            currentIndex.value = 0
            question.value = ''
            options.value = []
            correctAnswer.value = ''
            scoreboard.value = []
            answeredCount.value = 0
            totalPlayers.value = 0
          }
        }
        if (message.phase === 'finished') {
          leaderboard.value = message.leaderboard
        } else if (leaderboard.value) {
          leaderboard.value = null
        }
        error.value = ''
        phase.value = message.phase
        loadChat(message.roomCode)
        persistSession()
        if (message.resumeSecret) {
          saveSeat(message.resumeSecret, message.resumeTtlMs ?? RESUME_TTL_FALLBACK_MS)
        } else if (message.hostSecret) {
          saveSeat(message.hostSecret, RESUME_TTL_FALLBACK_MS)
        }
        startKeepalive()
        break
      }
      case 'pong':
        // clock-sync + proof of life; never touches phase or roster
        serverOffsetMs.value = message.serverNow - Date.now()
        break
      case 'host-disconnected':
        hostOnline.value = false
        hostOfflineExpiresAt.value = message.expiresAt
        break
      case 'lobby-updated':
        players.value = message.players
        quizReady.value = message.quizReady ?? quizReady.value
        break
      case 'host-status-updated':
        hostStatus.value = message.status
        hostDetail.value = message.detail ?? ''
        if (message.topic !== undefined) topic.value = message.topic
        if (message.hostOnline !== undefined) {
          hostOnline.value = message.hostOnline
          if (message.hostOnline) hostOfflineExpiresAt.value = 0
          else if (message.hostOfflineExpiresAt) {
            hostOfflineExpiresAt.value = message.hostOfflineExpiresAt
          }
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
      case 'question-started': {
        // players only see the correct answer for the *current* question once revealed
        // (all-answered, timer expired, or host force-skips with a 3s reveal first)
        currentIndex.value = message.index
        total.value = message.total
        question.value = message.question
        options.value = message.options
        timerSeconds.value = message.timerSeconds
        deadline.value = message.deadline
        correctAnswer.value = message.correctAnswer
        myAnswer.value = null
        allAnswered.value = false
        error.value = ''
        liveAnswers.value = {}
        scoreboard.value = message.scoreboard ?? []
        answeredCount.value = 0
        totalPlayers.value = message.scoreboard?.length ?? players.value.length
        startingDeadline.value = null
        hostStatus.value = 'started'
        phase.value = 'question'
        break
      }
      case 'answer-updated':
        liveAnswers.value = {
          ...liveAnswers.value,
          [message.playerId]: {
            name: message.name,
            option: message.option,
            correct: message.correct,
          },
        }
        break
      case 'answer-progress':
        answeredCount.value = message.answeredCount
        totalPlayers.value = message.totalPlayers
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
      case 'all-answered':
        allAnswered.value = true
        correctAnswer.value = message.correctAnswer
        scoreboard.value = message.scoreboard ?? []
        break
      case 'game-finished':
        leaderboard.value = message.leaderboard
        phase.value = 'finished'
        break
      case 'room-to-lobby':
        // host took the room back to the lobby — same room code and roster,
        // per-round state cleared so new players can join and the host can rematch
        players.value = message.players
        topic.value = message.topic
        quizReady.value = message.quizReady ?? true
        hostStatus.value = 'waiting-to-start'
        hostDetail.value = ''
        startingDeadline.value = null
        leaderboard.value = null
        scoreboard.value = []
        answeredCount.value = 0
        totalPlayers.value = 0
        liveAnswers.value = {}
        currentIndex.value = 0
        total.value = 0
        question.value = ''
        options.value = []
        correctAnswer.value = ''
        allAnswered.value = false
        myAnswer.value = null
        phase.value = 'lobby'
        break
      case 'game-closed':
        if (phase.value !== 'finished') {
          close('The host ended the game.')
        }
        break
      case 'host-left':
        close('The host left the game.')
        break
      case 'error':
        error.value = message.message
        // failed join/create should return to the form instead of staying stuck on loading
        if (phase.value === 'connecting') {
          phase.value = 'idle'
        }
        break
    }
  }

  function reset() {
    role.value = 'none'
    phase.value = 'idle'
    roomCode.value = ''
    topic.value = ''
    playerId.value = null
    playerName.value = ''
    players.value = []
    currentIndex.value = 0
    total.value = 0
    question.value = ''
    options.value = []
    timerSeconds.value = 0
    deadline.value = null
    correctAnswer.value = ''
    myAnswer.value = null
    allAnswered.value = false
    hostQuestions.value = []
    liveAnswers.value = {}
    scoreboard.value = []
    answeredCount.value = 0
    totalPlayers.value = 0
    leaderboard.value = null
    quizReady.value = true
    hostStatus.value = 'waiting-to-start'
    hostDetail.value = ''
    hostOnline.value = true
    hostOfflineExpiresAt.value = 0
    startingDeadline.value = null
    connection.value = 'online'
    serverOffsetMs.value = 0
    stopKeepalive()
    chatMessages.value = []
    closedMessage.value = ''
    error.value = ''
    evictedMessage.value = ''
    // do not clear shouldReconnect here — leave() / close() handle it; createRoom/joinRoom reset it
  }

  function close(message: string) {
    shouldReconnect = false
    stopKeepalive()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    clearResume()
    clearSession()
    releaseActiveSession()
    phase.value = 'closed'
    closedMessage.value = message
  }

  function createRoom(settings: {
    topic: string
    questions: QuestionFormat[]
    timerSeconds: number
    maxPlayers: number
  }) {
    reset()
    shouldReconnect = true
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    role.value = 'host'
    phase.value = 'connecting'
    topic.value = settings.topic
    hostQuestions.value = settings.questions
    maxPlayers.value = settings.maxPlayers
    quizReady.value = settings.questions.length > 0
    hostStatus.value = settings.questions.length > 0 ? 'waiting-to-start' : 'generating'
    hostDetail.value = ''
    claimActiveSession({ code: 'PENDING', role: 'host' })
    connect()
    send({
      type: 'create-room',
      topic: settings.topic,
      timerSeconds: settings.timerSeconds,
      maxPlayers: settings.maxPlayers,
      questions: settings.questions,
    })
  }

  function joinRoom(code: string, name: string) {
    reset()
    shouldReconnect = true
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    role.value = 'player'
    phase.value = 'connecting'
    playerName.value = name
    error.value = ''
    const normalizedCode = code.trim().toUpperCase()
    claimActiveSession({ code: normalizedCode, role: 'player', playerName: name })
    connect()
    send({ type: 'join', code: normalizedCode, name })
  }

  /** Check whether joining another room would conflict with another live tab.
   * Returns the live blocking session or null. UI should prompt before calling
   * joinRoom/createRoom. */
  function checkRoomConflict(): {
    tabId: string
    code: string
    role: 'host' | 'player'
    playerName?: string
    ageMs: number
  } | null {
    return getBlockingSession()
  }

  /** Enters the player join flow without connecting yet (e.g. via a ?room= join link). */
  function prepareJoin() {
    reset()
    role.value = 'player'
    // tentatively claim the slot so a second tab sees the conflict before the user enters a name
    const params = new URLSearchParams(window.location.search)
    const code = (params.get('room') ?? '').toUpperCase().slice(0, 6)
    if (code.length === 6) {
      claimActiveSession({ code, role: 'player' })
    }
  }

  function startGame() {
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

  function setHostStatus(status: HostStatus, detail = '') {
    hostStatus.value = status
    hostDetail.value = detail
    send({ type: 'host-status', status, detail })
  }

  function submitAnswer(option: string) {
    myAnswer.value = option
    send({ type: 'answer', option })
  }

  function sendChat(text: string) {
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH)
    if (!trimmed) return
    send({ type: 'chat', id: crypto.randomUUID(), text: trimmed })
  }

  function nextQuestion() {
    send({ type: 'next-question' })
  }

  /** Host returns a finished room to the lobby. Same room code and roster, so
   * new players can join and the host can rematch with the same questions. */
  function backToLobby() {
    send({ type: 'back-to-lobby' })
  }

  /** Player goes back to the lobby view after a finished game without leaving
   * the room. View-only: the server roster is untouched, so later broadcasts
   * (lobby updates, close) keep working and a refresh resyncs server truth. */
  function returnToLobby() {
    if (phase.value !== 'finished') return
    phase.value = 'lobby'
  }

  /** Host replaces the lobby room's quiz content after changing the setup.
   * The room stays in the lobby so everyone waits for Start. */
  function updateRoomQuiz(settings: {
    topic: string
    timerSeconds: number
    maxPlayers: number
    questions: QuestionFormat[]
  }) {
    send({
      type: 'update-room-quiz',
      topic: settings.topic,
      timerSeconds: settings.timerSeconds,
      maxPlayers: settings.maxPlayers,
      questions: settings.questions,
    })
  }

  function closeRoom() {
    send({ type: 'close-room' })
  }

  /** Best-effort intentional-exit signal (frees the seat, skips the grace hold). */
  function signalExit() {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'client-exit' }))
      }
    } catch {}
    try {
      const sess = loadSession()
      if (
        sess &&
        sess.code &&
        sess.role === 'player' &&
        sess.playerId &&
        sess.secret &&
        typeof navigator !== 'undefined' &&
        typeof navigator.sendBeacon === 'function'
      ) {
        navigator.sendBeacon(
          `${roomServerOrigin()}/leave`,
          JSON.stringify({
            code: sess.code,
            playerId: sess.playerId,
            secret: sess.secret,
          }),
        )
      }
    } catch {}
  }

  function leave() {
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
    reconnectAttempts = 0
    connection.value = 'online'
    clearResume()
    clearSession()
    releaseActiveSession()
    // explicit leave drops the local chat copy; a mere refresh keeps it
    clearChat(roomCode.value)
    reset()
  }

  /** One-tap resume from the local mirror (crashed/new tab, seat still warm). */
  function resumePlayer(code: string, name: string) {
    reset()
    shouldReconnect = true
    reconnectAttempts = 0
    connection.value = 'reconnecting'
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    role.value = 'player'
    phase.value = 'connecting'
    playerName.value = name
    error.value = ''
    const normalizedCode = code.trim().toUpperCase()
    claimActiveSession({ code: normalizedCode, role: 'player', playerName: name })
    connect()
    const mirror = loadMirrorSecret(normalizedCode)
    pending.push({
      type: 'rejoin',
      code: normalizedCode,
      playerId: mirror?.playerId ?? '',
      name,
      secret: mirror?.secret,
    })
  }

  /** Host one-tap resume from the local mirror. Caller flips to the group view. */
  function resumeHost(code: string) {
    reset()
    shouldReconnect = true
    reconnectAttempts = 0
    connection.value = 'reconnecting'
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    role.value = 'host'
    phase.value = 'connecting'
    error.value = ''
    const normalizedCode = code.trim().toUpperCase()
    claimActiveSession({ code: normalizedCode, role: 'host' })
    connect()
    const mirror = loadMirrorSecret(normalizedCode)
    pending.push({ type: 'rejoinHost', code: normalizedCode, secret: mirror?.secret })
  }

  function loadMirrorSecret(code: string): { playerId: string | null; secret: string } | null {
    try {
      const raw = localStorage.getItem(resumeStorageKey(code))
      if (!raw) return null
      const parsed = JSON.parse(raw) as ResumeRecord
      if (!parsed.secret || !resumeFresh(parsed)) return null
      return { playerId: parsed.playerId, secret: parsed.secret }
    } catch {
      return null
    }
  }

  // when another tab forces us to drop our session, surface it to the UI
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
    releaseActiveSession()
    phase.value = 'closed'
    closedMessage.value = ''
    evictedMessage.value = previousRoom
      ? `You left Room ${previousRoom} because another tab took over.`
      : 'Another tab took over this session.'
  })

  /** Forcibly claim the room slot held by another tab. Called after the user confirms. */
  function forceTakeover(victimTabId: string) {
    evictOtherTab(victimTabId)
  }

  // reconnect immediately when tab becomes visible again (screen-off) or network returns
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
    maxPlayers,
    topic,
    playerId,
    playerName,
    players,
    currentIndex,
    total,
    question,
    options,
    timerSeconds,
    deadline,
    correctAnswer,
    myAnswer,
    allAnswered,
    hostQuestions,
    liveAnswers,
    scoreboard,
    answeredCount,
    totalPlayers,
    quizReady,
    hostStatus,
    hostDetail,
    hostOnline,
    hostOfflineExpiresAt,
    startingDeadline,
    connection,
    serverOffsetMs,
    myReady,
    readyCount,
    allReady,
    chatMessages,
    sendChat,
    myRank,
    leaderboard,
    closedMessage,
    error,
    evictedMessage,
    getBlockingSession,
    forceTakeover,
    checkRoomConflict,
    createRoom,
    joinRoom,
    resumePlayer,
    resumeHost,
    getResumeOffer,
    discardResume,
    retryNow,
    prepareJoin,
    startGame,
    cancelStart,
    toggleReady,
    kickPlayer,
    setHostStatus,
    submitAnswer,
    nextQuestion,
    backToLobby,
    returnToLobby,
    updateRoomQuiz,
    closeRoom,
    leave,
  }
})
