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
  randomId,
  releaseActiveSession,
} from './groupTabSync'
import { decideSend, openBurst, rejoinMessageFor, shouldAutoResume } from './reconnectPolicy'

export type GroupRole = 'none' | 'host' | 'player'
export type GroupPhase = 'idle' | 'connecting' | 'lobby' | 'question' | 'finished' | 'closed'

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
  let resuming = false
  const reconnecting = ref(false)

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
  // Lobby group chat. The server only relays messages — every client keeps its
  // own copy in localStorage so a refresh restores the visible history.
  const chatMessages = ref<ChatMessage[]>([])
  const closedMessage = ref('')
  const error = ref('')
  const evictedMessage = ref('')

  const STORAGE_KEY = 'quiznix-group'
  const MAX_CHAT_MESSAGES = 100
  const MAX_CHAT_LENGTH = 200

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

  function persistSession() {
    try {
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
    topic?: string
    hostQuestions?: QuestionFormat[]
    maxPlayers?: number
  } | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const UNREACHABLE_MESSAGE = `Cannot reach the room server at ${roomServerUrl()}. Start it with \`npm run dev:all\` (or \`npm run server\`), then try again.`

  function send(message: GroupClientMessage) {
    const state =
      socket && socket.readyState === WebSocket.OPEN
        ? 'open'
        : socket && socket.readyState === WebSocket.CONNECTING
          ? 'connecting'
          : 'down'
    switch (decideSend(state, shouldReconnect, phase.value)) {
      case 'send':
        socket?.send(JSON.stringify(message))
        return
      case 'queue-redial':
        // Mid-game taps while the socket is down wait for the redial instead
        // of killing the session.
        pending.push(message)
        connect()
        return
      case 'queue':
        // first message is sent while the socket is still opening
        pending.push(message)
        return
      case 'close':
        close(UNREACHABLE_MESSAGE)
        return
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (phase.value === 'finished' || phase.value === 'closed') return
    const base = 1000 * Math.pow(2, reconnectAttempts)
    const delay = Math.min(base, 30000) + Math.random() * 500
    console.log(`[group] disconnected — reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts + 1})`)
    reconnectAttempts++
    reconnecting.value = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => connect(), delay)
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
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
      reconnecting.value = false
      // auto-rejoin on reconnect (screen-off / background grace) using stored
      // session — the rejoin goes first so queued answers land on a known slot
      const rejoin = shouldReconnect
        ? rejoinMessageFor(loadSession(), phase.value, playerName.value)
        : null
      for (const message of openBurst(rejoin, pending.splice(0))) {
        socket?.send(JSON.stringify(message))
      }
    }
    socket.onmessage = (event) => handle(JSON.parse(event.data) as GroupServerMessage)
    socket.onerror = () => {
      // triggers onclose — let the close handler decide to reconnect
      socket?.close()
    }
    socket.onclose = () => {
      // if we intentionally left (leave/closeRoom) or game finished, do not reconnect
      if (!shouldReconnect || phase.value === 'finished' || phase.value === 'closed') {
        pending = []
        return
      }
      // transient drop while in lobby/question/connecting — keep pending for retry
      // and try to re-establish with exponential backoff instead of immediately showing unreachable
      if (phase.value === 'connecting' || phase.value === 'lobby' || phase.value === 'question') {
        scheduleReconnect()
        return
      }
      pending = []
      close(UNREACHABLE_MESSAGE)
    }
  }

  function handle(message: GroupServerMessage) {
    switch (message.type) {
      case 'room-created':
        roomCode.value = message.code
        phase.value = 'lobby'
        loadChat(message.code)
        persistSession()
        resuming = false
        break
      case 'joined':
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        phase.value = 'lobby'
        loadChat(message.roomCode)
        persistSession()
        resuming = false
        break
      case 'lobby-updated':
        players.value = message.players
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
        if (resuming) {
          // auto-resume hit a dead room (closed, expired, full): drop the stale
          // session and land on the ended prompt instead of the join form
          resuming = false
          close(
            /not found|expired|closed|already started|full|already connected/i.test(message.message)
              ? message.message
              : 'This room has ended.',
          )
        } else if (phase.value === 'connecting') {
          // failed join/create should return to the form instead of staying stuck on loading
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
    chatMessages.value = []
    closedMessage.value = ''
    error.value = ''
    evictedMessage.value = ''
    reconnecting.value = false
    resuming = false
    // do not clear shouldReconnect here — leave() / close() handle it; createRoom/joinRoom reset it
    // (explicit leave also clears the stored session via clearSession, so a
    // later visit never auto-resumes a room the user chose to exit)
  }

  function close(message: string) {
    shouldReconnect = false
    reconnecting.value = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    clearSession()
    releaseActiveSession()
    phase.value = 'closed'
    closedMessage.value = message
  }

  /** Manual retry after a failed (re)join: re-sends the stored rejoin on the
   * live socket, or redials when the socket is down. */
  function rejoinNow() {
    if (!shouldReconnect) return
    error.value = ''
    if (socket && socket.readyState === WebSocket.OPEN) {
      const rejoin = rejoinMessageFor(loadSession(), phase.value, playerName.value)
      if (rejoin) {
        socket.send(JSON.stringify(rejoin))
        return
      }
    }
    reconnectAttempts = 0
    connect()
  }

  /**
   * Resume a live room after a page refresh without making the user retype
   * the code and name. Redials when the stored session matches the expected
   * room (join link) and no live tab already holds it; returns true when a
   * redial started. A failed resume clears the stale session and lands on
   * the ended prompt via the error handler. Never resumes after an explicit
   * leave — leave() deletes the stored session.
   */
  function autoResume(expectedCode?: string): boolean {
    if (phase.value !== 'idle') return false
    const sess = loadSession()
    if (!sess || sess.role === 'none') return false
    if (!shouldAutoResume(sess, expectedCode, getBlockingSession()?.code ?? null)) {
      return false
    }
    if (sess.role !== 'host' && sess.role !== 'player') return false
    reset()
    shouldReconnect = true
    reconnectAttempts = 0
    resuming = true
    role.value = sess.role
    roomCode.value = sess.code
    playerId.value = sess.playerId
    playerName.value = sess.playerName
    topic.value = sess.topic ?? ''
    hostQuestions.value = sess.hostQuestions ?? []
    if (sess.maxPlayers) maxPlayers.value = sess.maxPlayers
    phase.value = 'connecting'
    error.value = ''
    claimActiveSession(
      sess.role === 'player'
        ? { code: sess.code, role: sess.role, playerName: sess.playerName }
        : { code: sess.code, role: sess.role },
    )
    connect()
    return true
  }

  function createRoom(settings: {
    topic: string
    questions: QuestionFormat[]
    timerSeconds: number
    maxPlayers: number
  }) {
    reset()
    shouldReconnect = true
    // a deliberate join supersedes any stored session/queue: without this the
    // redial would rejoin the old room first and then create a second slot
    clearSession()
    pending = []
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
    // a deliberate join supersedes any stored session/queue: without this the
    // redial would rejoin the old slot first and the flushed join would mint
    // a duplicate roster entry for the same user
    clearSession()
    pending = []
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
    send({ type: 'start-game' })
  }

  function submitAnswer(option: string) {
    myAnswer.value = option
    send({ type: 'answer', option })
  }

  function sendChat(text: string) {
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH)
    if (!trimmed) return
    send({ type: 'chat', id: randomId(), text: trimmed })
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

  function leave() {
    shouldReconnect = false
    reconnecting.value = false
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
    clearSession()
    releaseActiveSession()
    // explicit leave drops the local chat copy; a mere refresh keeps it
    clearChat(roomCode.value)
    reset()
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
    reconnecting.value = false
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
      if (document.visibilityState === 'visible' && shouldReconnect && (phase.value === 'lobby' || phase.value === 'question' || phase.value === 'connecting')) {
        connect()
      }
    })
    window.addEventListener('online', () => {
      if (shouldReconnect && (phase.value === 'lobby' || phase.value === 'question' || phase.value === 'connecting')) {
        connect()
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
    chatMessages,
    sendChat,
    myRank,
    leaderboard,
    closedMessage,
    error,
    evictedMessage,
    reconnecting,
    rejoinNow,
    autoResume,
    getBlockingSession,
    forceTakeover,
    checkRoomConflict,
    createRoom,
    joinRoom,
    prepareJoin,
    startGame,
    submitAnswer,
    nextQuestion,
    backToLobby,
    returnToLobby,
    updateRoomQuiz,
    closeRoom,
    leave,
  }
})
