import { ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  GroupClientMessage,
  GroupServerMessage,
  LeaderboardEntry,
  PlayerInfo,
} from '../groupProtocol'

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
  const myAnswer = ref<string | null>(null)
  const hostQuestions = ref<QuestionFormat[]>([])
  const liveAnswers = ref<Record<string, { name: string; option: string; correct: boolean }>>({})
  const leaderboard = ref<LeaderboardEntry[] | null>(null)
  const closedMessage = ref('')
  const error = ref('')

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

  function connect() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return
    }
    socket = new WebSocket(roomServerUrl())
    socket.onopen = () => {
      const queued = pending.splice(0)
      for (const message of queued) {
        socket?.send(JSON.stringify(message))
      }
    }
    socket.onmessage = (event) => handle(JSON.parse(event.data) as GroupServerMessage)
    socket.onclose = () => {
      pending = []
      if (phase.value !== 'finished' && phase.value !== 'closed') {
        close(UNREACHABLE_MESSAGE)
      }
    }
  }

  function handle(message: GroupServerMessage) {
    switch (message.type) {
      case 'room-created':
        roomCode.value = message.code
        phase.value = 'lobby'
        break
      case 'joined':
        playerId.value = message.playerId
        roomCode.value = message.roomCode
        players.value = message.players
        phase.value = 'lobby'
        break
      case 'lobby-updated':
        players.value = message.players
        break
      case 'question-started':
        currentIndex.value = message.index
        total.value = message.total
        question.value = message.question
        options.value = message.options
        timerSeconds.value = message.timerSeconds
        deadline.value = message.deadline
        myAnswer.value = null
        error.value = ''
        liveAnswers.value = {}
        phase.value = 'question'
        break
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
      case 'game-finished':
        leaderboard.value = message.leaderboard
        phase.value = 'finished'
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
    myAnswer.value = null
    hostQuestions.value = []
    liveAnswers.value = {}
    leaderboard.value = null
    closedMessage.value = ''
    error.value = ''
  }

  function close(message: string) {
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
    role.value = 'host'
    phase.value = 'connecting'
    topic.value = settings.topic
    hostQuestions.value = settings.questions
    maxPlayers.value = settings.maxPlayers
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
    role.value = 'player'
    playerName.value = name
    connect()
    send({ type: 'join', code: code.trim().toUpperCase(), name })
  }

  /** Enters the player join flow without connecting yet (e.g. via a ?room= join link). */
  function prepareJoin() {
    reset()
    role.value = 'player'
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

  function closeRoom() {
    send({ type: 'close-room' })
  }

  function leave() {
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = null
    }
    pending = []
    reset()
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
    myAnswer,
    hostQuestions,
    liveAnswers,
    leaderboard,
    closedMessage,
    error,
    createRoom,
    joinRoom,
    prepareJoin,
    startGame,
    submitAnswer,
    nextQuestion,
    closeRoom,
    leave,
  }
})
