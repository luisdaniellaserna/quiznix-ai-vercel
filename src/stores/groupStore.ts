import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
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
export type GroupPhase = 'idle' | 'connecting' | 'lobby' | 'question' | 'finished' | 'closed' | 'between-rounds'

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
  // Final leaderboard from the most recent finished round, kept so the host's
  // "Play again" transition (and the player's waiting card) can show the
  // previous results even after the room has moved into 'between-rounds'.
  const lastFinalLeaderboard = ref<LeaderboardEntry[] | null>(null)
  const closedMessage = ref('')
  const error = ref('')
  const evictedMessage = ref('')

  const STORAGE_KEY = 'quiznix-group'

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
  function loadSession(): { code: string; playerId: string | null; playerName: string; role: GroupRole } | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  const UNREACHABLE_MESSAGE = `Cannot reach the room server at ${roomServerUrl()}. Start it with \`npm run dev:all\` (or \`npm run server\`), then try again.`

  function send(message: GroupClientMessage) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    } else if (socket && socket.readyState === WebSocket.CONNECTING) {
      // first message is sent while the socket is still opening
      pending.push(message)
    } else {
      close(UNREACHABLE_MESSAGE)
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (phase.value === 'finished' || phase.value === 'closed') return
    const base = 1000 * Math.pow(2, reconnectAttempts)
    const delay = Math.min(base, 30000) + Math.random() * 500
    console.log(`[group] disconnected — reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts + 1})`)
    reconnectAttempts++
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
      const queued = pending.splice(0)
      for (const message of queued) {
        socket?.send(JSON.stringify(message))
      }
      // auto-rejoin on reconnect (screen-off / background grace) using stored session
      if (queued.length === 0 && shouldReconnect) {
        const sess = loadSession()
        if (sess && sess.code && sess.role === 'player' && sess.playerId) {
          // only rejoin if we are still in a game that expects it
          if (phase.value === 'lobby' || phase.value === 'question' || phase.value === 'connecting') {
            socket?.send(JSON.stringify({ type: 'rejoin', code: sess.code, playerId: sess.playerId, name: sess.playerName || playerName.value }))
          }
        } else if (sess && sess.code && sess.role === 'host') {
          if (phase.value === 'lobby' || phase.value === 'question' || phase.value === 'connecting') {
            socket?.send(JSON.stringify({ type: 'rejoinHost', code: sess.code }))
          }
        }
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
        persistSession()
        break
      case 'joined':
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        phase.value = 'lobby'
        persistSession()
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
      case 'all-answered':
        allAnswered.value = true
        correctAnswer.value = message.correctAnswer
        scoreboard.value = message.scoreboard ?? []
        break
      case 'game-finished':
        leaderboard.value = message.leaderboard
        lastFinalLeaderboard.value = message.leaderboard
        phase.value = 'finished'
        break
      case 'room-resetting':
        // host kicked off a new round — keep last results visible, clear per-round state
        lastFinalLeaderboard.value = message.leaderboard
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
        phase.value = 'between-rounds'
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
    lastFinalLeaderboard.value = null
    closedMessage.value = ''
    error.value = ''
    evictedMessage.value = ''
    // do not clear shouldReconnect here — leave() / close() handle it; createRoom/joinRoom reset it
  }

  function close(message: string) {
    shouldReconnect = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
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
    send({ type: 'start-game' })
  }

  function submitAnswer(option: string) {
    myAnswer.value = option
    send({ type: 'answer', option })
  }

  function nextQuestion() {
    send({ type: 'next-question' })
  }

  /** Host kicks off a new round from the leaderboard. Players stay in the
   * room and see a "waiting for host" card until the host picks new topics. */
  function restartRoom() {
    send({ type: 'restart-room' })
  }

  /** Host commits the new round's topics and questions after restartRoom. */
  function startNextGame(settings: {
    topic: string
    timerSeconds: number
    maxPlayers: number
    questions: QuestionFormat[]
  }) {
    send({
      type: 'start-next-game',
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
    myRank,
    leaderboard,
    lastFinalLeaderboard,
    closedMessage,
    error,
    evictedMessage,
    getBlockingSession,
    forceTakeover,
    checkRoomConflict,
    createRoom,
    joinRoom,
    prepareJoin,
    startGame,
    submitAnswer,
    nextQuestion,
    restartRoom,
    startNextGame,
    closeRoom,
    leave,
  }
})
