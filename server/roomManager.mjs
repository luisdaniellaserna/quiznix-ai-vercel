import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const MAX_NAME_LENGTH = 24
const MAX_IDLE_MS = 2 * 60 * 60 * 1000
const ANSWER_GRACE_MS = 1500
const POINTS_BASE = 10
const POINTS_MIN = 5
// A dropped player keeps their seat, ready state, answers and score for 5
// minutes so a tunnel, crash or Render free-tier blip is recoverable one-tap.
const PLAYER_GRACE_MS = 5 * 60 * 1000
// Host absence freezes the room for players; 3 minutes bounds that dead air
// while still covering a laptop sleep / tab crash.
const HOST_GRACE_MS = 3 * 60 * 1000
const FORCE_REVEAL_MS = 3000
const MAX_CHAT_LENGTH = 200
const COUNTDOWN_MS = 5000
// Host-supplied content caps — every field here is re-broadcast to all clients
const MAX_TOPIC_LENGTH = 120
const MAX_QUESTIONS = 100
const MAX_QUESTION_LENGTH = 500
const MAX_ANSWER_LENGTH = 100
const MAX_INCORRECT_ANSWERS = 8
const MAX_TIMER_SECONDS = 300
const MAX_ROOMS = 100
// Token bucket per client for chatty messages (chat, answer) — capacity is the
// burst size, the refill interval the sustained rate.
const RATE_CAPACITY = 8
const RATE_REFILL_MS = 500
const MAX_CHAT_ID_LENGTH = 64

/**
 * Error carrying a machine-readable code so clients can branch without
 * matching on prose. Messages remain stable and human-facing.
 */
export class RoomError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const HOST_STATUSES = new Set([
  'choosing-topic',
  'generating',
  'waiting-to-start',
  'countdown',
  'started',
])

/** Resume-token helpers: unguessable per-seat secrets, sha256-hashed at rest. */
function newSecret() {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

function hashSecret(secret) {
  return createHash('sha256')
    .update(String(secret ?? ''), 'utf8')
    .digest('hex')
}

function secretMatches(storedHash, presented) {
  if (typeof storedHash !== 'string' || typeof presented !== 'string' || presented === '') {
    return false
  }
  const a = Buffer.from(hashSecret(presented), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Timer/cap validation shared by create + update (message text kept stable). */
function assertValidSettings({ timerSeconds, maxPlayers }) {
  if (
    !Number.isFinite(timerSeconds) ||
    timerSeconds <= 0 ||
    timerSeconds > MAX_TIMER_SECONDS
  ) {
    throw new Error('Invalid timer setting.')
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 100) {
    throw new Error('Max participants must be between 2 and 100.')
  }
}

/** Non-empty question list validation (allows empty only at create-time for instant rooms). */
function validQuestion(q) {
  return (
    typeof q.question === 'string' &&
    q.question !== '' &&
    q.question.length <= MAX_QUESTION_LENGTH &&
    typeof q.correct_answer === 'string' &&
    q.correct_answer !== '' &&
    q.correct_answer.length <= MAX_ANSWER_LENGTH &&
    Array.isArray(q.incorrect_answers) &&
    q.incorrect_answers.length >= 1 &&
    q.incorrect_answers.length <= MAX_INCORRECT_ANSWERS &&
    q.incorrect_answers.every(
      (a) => typeof a === 'string' && a !== '' && a.length <= MAX_ANSWER_LENGTH,
    )
  )
}

/** Non-empty question list validation (allows empty only at create-time for instant rooms). */
function assertValidQuestions(questions) {
  const valid = Array.isArray(questions) && questions.length > 0 && questions.length <= MAX_QUESTIONS && questions.every(validQuestion)
  if (!valid) {
    throw new Error('Invalid question set.')
  }
}

/** Scoreboard entry used by players to see live rank; matches groupProtocol.ts. */
function buildScoreboard(room) {
  // include the current question's answers too — by the time the scoreboard is
  // broadcast (all-answered / start of next question) every score that should
  // count for "rank so far" is already in.
  const lastScoredIndex = room.index
  const entries = []
  for (const [playerId, player] of room.players) {
    let correct = 0
    let score = 0
    for (let i = 0; i <= lastScoredIndex; i++) {
      const answer = player.answers.get(i)
      if (answer && answer.option === room.questions[i].correct_answer) {
        correct++
        const ratio = answer.timeLeftMs / (room.timerSeconds * 1000)
        score += Math.round(1000 * (POINTS_MIN + (POINTS_BASE - POINTS_MIN) * ratio))
      }
    }
    entries.push({
      playerId,
      name: player.name,
      score,
      correct,
    })
  }
  entries.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return entries
}

/**
 * Authoritative, transport-free state machine for group quiz rooms.
 * Emits { to, message } via the onSend callback: `to` is 'host', 'players',
 * 'all', or a player id; the WebSocket layer routes those to sockets.
 * All mutating methods throw Error on invalid requests.
 */
export class RoomManager {
  constructor({ now = Date.now, onSend = () => {} } = {}) {
    this.now = now
    this.onSend = onSend
    this.rooms = new Map()
    this.hostRooms = new Map()
    this.playerRooms = new Map()
    this.playerSeq = 0
    this.messageBudgets = new Map()
  }

  emit(code, to, message, clientId) {
    this.onSend({ to, message, code, clientId })
  }

  /** Token bucket shared by chatty client messages; throws when drained. */
  consumeRate(clientId) {
    const nowMs = this.now()
    const bucket = this.messageBudgets.get(clientId) ?? {
      tokens: RATE_CAPACITY,
      updatedAt: nowMs,
    }
    bucket.tokens = Math.min(
      RATE_CAPACITY,
      bucket.tokens + (nowMs - bucket.updatedAt) / RATE_REFILL_MS,
    )
    bucket.updatedAt = nowMs
    if (bucket.tokens < 1) {
      this.messageBudgets.set(clientId, bucket)
      throw new RoomError('RATE_LIMITED', 'You are doing that too often. Slow down a little.')
    }
    bucket.tokens -= 1
    this.messageBudgets.set(clientId, bucket)
  }

  createRoom(clientId, { topic, timerSeconds, questions, maxPlayers }) {
    const list = Array.isArray(questions) ? questions : []
    assertValidSettings({ timerSeconds, maxPlayers })
    if (list.length > 0) {
      assertValidQuestions(list)
    }
    // One live room per host socket: a replayed create-room closes the prior
    // room instead of orphaning it with a host binding that blocks the sweep.
    // Players are told directly; the same socket is busy creating, so it is
    // deliberately not included.
    // The socket becomes host-only: release any player seat it still holds,
    // otherwise the seat would linger "connected" after the role switch.
    this.playerDisconnected(clientId)
    const priorCode = this.hostRooms.get(clientId)
    if (priorCode) {
      const prior = this.rooms.get(priorCode)
      if (prior) {
        this.emit(prior.code, 'players', { type: 'game-closed' })
        this.deleteRoom(prior)
      } else {
        this.hostRooms.delete(clientId)
      }
    }
    if (this.rooms.size >= MAX_ROOMS) {
      throw new Error('Too many active rooms. Please try again later.')
    }

    const code = this.nextCode()
    const quizReady = list.length > 0
    const hostSecret = newSecret()
    this.rooms.set(code, {
      code,
      hostClientId: clientId,
      hostSecretHash: hashSecret(hostSecret),
      hostDisconnectedAt: null,
      topic: String(topic ?? '').slice(0, MAX_TOPIC_LENGTH),
      timerSeconds,
      maxPlayers,
      questions: list,
      quizReady,
      hostStatus: quizReady ? 'waiting-to-start' : 'generating',
      hostDetail: '',
      phase: 'lobby',
      index: -1,
      deadline: 0,
      countdownDeadline: 0,
      players: new Map(),
      createdAt: this.now(),
    })
    this.hostRooms.set(clientId, code)
    this.emit(code, 'host', { type: 'room-created', code, hostSecret }, clientId)
    return { code, hostSecret }
  }

  joinRoom(clientId, code, name) {
    const room = this.rooms.get(String(code).trim().toUpperCase())
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', 'Room not found. Check the code and try again.')
    }
    if (room.phase === 'starting') {
      throw new RoomError('GAME_STARTING', 'The game is starting. Please wait for the next round.')
    }
    if (room.phase !== 'lobby') {
      throw new RoomError('GAME_STARTED', 'The game has already started.')
    }
    const trimmed = String(name ?? '').trim()
    if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) {
      throw new RoomError(
        'NAME_INVALID',
        `A player name is required (1-${MAX_NAME_LENGTH} characters).`,
      )
    }
    // A socket holds at most one seat: switching rooms releases the old one so
    // it cannot linger "connected" (its eventual close would misattribute the
    // drop to the new seat). Same-room rebinds keep their own paths below.
    const priorEntry = this.playerRooms.get(clientId)
    if (priorEntry && priorEntry.code !== room.code) {
      this.playerDisconnected(clientId)
    }
    // same-name reclaim within grace (covers screen-off without playerId).
    // Lobby/starting only (joinRoom already rejects other phases) so a stranger
    // can't walk into a live game under someone else's name — mid-game return
    // requires the resume token via rejoin().
    for (const [pid, p] of room.players) {
      if (p.name === trimmed && p.clientId === null) {
        if (p.disconnectedAt != null && this.now() - p.disconnectedAt > PLAYER_GRACE_MS) {
          room.players.delete(pid)
          continue
        }
        const resumeSecret = newSecret()
        p.secretHash = hashSecret(resumeSecret)
        p.clientId = clientId
        p.disconnectedAt = null
        this.playerRooms.set(clientId, { code: room.code, playerId: pid })
        const players = this.playersOf(room)
        this.emit(
          room.code,
          pid,
          {
            type: 'joined',
            playerId: pid,
            name: p.name,
            roomCode: room.code,
            players,
            quizReady: room.quizReady,
            hostStatus: room.hostStatus,
            hostDetail: room.hostDetail,
            resumeSecret,
            resumeTtlMs: PLAYER_GRACE_MS,
          },
          clientId,
        )
        this.broadcastRoster(room)
        return { code: room.code, playerId: pid, resumeSecret }
      }
    }
    if (room.players.size >= room.maxPlayers) {
      throw new RoomError('ROOM_FULL', 'This room is full.')
    }

    const playerId = `p-${++this.playerSeq}`
    const resumeSecret = newSecret()
    room.players.set(playerId, {
      clientId,
      name: trimmed,
      answers: new Map(),
      disconnectedAt: null,
      ready: false,
      secretHash: hashSecret(resumeSecret),
    })
    this.playerRooms.set(clientId, { code: room.code, playerId })
    const players = this.playersOf(room)
    this.emit(
      room.code,
      playerId,
      {
        type: 'joined',
        playerId,
        name: trimmed,
        roomCode: room.code,
        players,
        quizReady: room.quizReady,
        hostStatus: room.hostStatus,
        hostDetail: room.hostDetail,
        resumeSecret,
        resumeTtlMs: PLAYER_GRACE_MS,
      },
      clientId,
    )
    this.broadcastRoster(room)
    return { code: room.code, playerId, resumeSecret }
  }

  /**
   * Atomic snapshot for a (re)joining seat. One message carries the whole room
   * truth so a client that dropped mid-game hydrates in a single apply instead
   * of racing deltas (lobby update, then question, then progress...).
   */
  buildStateSync(room, playerId) {
    const player = playerId ? room.players.get(playerId) : undefined
    let question = null
    if (room.phase === 'question') {
      const q = room.questions[room.index]
      question = {
        index: room.index,
        total: room.questions.length,
        question: q.question,
        options: this.optionsOf(room, room.index),
        timerSeconds: room.timerSeconds,
        deadline: room.deadline,
        scoreboard: buildScoreboard(room),
        myAnswer: player?.answers.get(room.index)?.option ?? null,
      }
      // Host-only payload: a player holding the answer mid-question could read
      // it from devtools, so player syncs get it only at reveal (all-answered).
      if (playerId == null) {
        question.correctAnswer = q.correct_answer
      }
    }
    return {
      type: 'state-sync',
      playerId: playerId ?? null,
      roomCode: room.code,
      phase: room.phase,
      players: this.playersOf(room),
      quizReady: room.quizReady,
      hostStatus: room.hostStatus,
      hostDetail: room.hostDetail ?? '',
      hostOnline: room.hostClientId !== null,
      hostOfflineExpiresAt: this.hostOfflineExpiresAt(room),
      topic: room.topic,
      timerSeconds: room.timerSeconds,
      maxPlayers: room.maxPlayers,
      countdownDeadline: room.phase === 'starting' ? room.countdownDeadline : 0,
      question,
      leaderboard: room.phase === 'finished' ? this.leaderboard(room) : null,
      serverNow: this.now(),
    }
  }

  hostOfflineExpiresAt(room) {
    if (room.hostClientId !== null || room.hostDisconnectedAt == null) return 0
    return room.hostDisconnectedAt + HOST_GRACE_MS
  }

  toggleReady(clientId, ready) {
    const entry = this.playerRooms.get(clientId)
    if (!entry) {
      throw new Error('Player not found.')
    }
    const room = this.rooms.get(entry.code)
    const player = room ? room.players.get(entry.playerId) : undefined
    if (!room || !player) {
      throw new Error('Player not found.')
    }
    if (room.phase !== 'lobby') {
      throw new Error('Ready can only change in the lobby.')
    }
    player.ready = Boolean(ready)
    this.broadcastRoster(room)
    return { ready: player.ready }
  }

  kickPlayer(hostClientId, playerId) {
    const room = this.roomOfHost(hostClientId)
    if (room.phase !== 'lobby' && room.phase !== 'starting') {
      throw new Error('Players can only be removed from the lobby.')
    }
    const player = room.players.get(playerId)
    if (!player) {
      throw new Error('Player not found.')
    }
    room.players.delete(playerId)
    // drop any socket mapping for a connected victim so the WS layer can close it
    for (const [cid, entry] of Array.from(this.playerRooms)) {
      if (entry.playerId === playerId && entry.code === room.code) {
        this.playerRooms.delete(cid)
      }
    }
    if (player.clientId) {
      this.emit(
        room.code,
        playerId,
        { type: 'kicked', message: 'You were removed by the host.' },
        player.clientId,
      )
    }
    this.broadcastRoster(room)
    return { playerId }
  }

  setHostStatus(hostClientId, status, detail = '') {
    const room = this.roomOfHost(hostClientId)
    if (room.phase !== 'lobby' && room.phase !== 'starting') {
      throw new Error('Host status can only change in the lobby.')
    }
    if (!HOST_STATUSES.has(status)) {
      throw new Error('Invalid host status.')
    }
    // countdown/started are server-driven — host may only set the editing states
    if (status === 'countdown' || status === 'started') {
      throw new Error('Invalid host status.')
    }
    room.hostStatus = status
    room.hostDetail = String(detail ?? '').slice(0, 120)
    this.broadcastHostStatus(room)
    return { status }
  }

  startGame(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'lobby') {
      throw new Error('The game has already started.')
    }
    if (!room.quizReady || room.questions.length === 0) {
      throw new Error('Finish generating questions before starting.')
    }
    if (room.players.size === 0) {
      throw new Error('Add at least one player before starting.')
    }
    const notReady = [...room.players.values()].filter((p) => !p.ready).length
    if (notReady > 0) {
      throw new Error('Waiting for all players to be ready.')
    }
    room.phase = 'starting'
    room.hostStatus = 'countdown'
    room.countdownDeadline = this.now() + COUNTDOWN_MS
    this.emit(room.code, 'all', {
      type: 'game-starting',
      deadline: room.countdownDeadline,
      countdownSeconds: Math.round(COUNTDOWN_MS / 1000),
    })
    this.broadcastHostStatus(room)
    this.scheduleAdvance(room, COUNTDOWN_MS)
  }

  cancelStart(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'starting') {
      throw new Error('There is no countdown to cancel.')
    }
    room.phase = 'lobby'
    room.pendingAdvance = null
    room.countdownDeadline = 0
    room.hostStatus = 'waiting-to-start'
    this.emit(room.code, 'all', { type: 'game-start-cancelled' })
    this.broadcastHostStatus(room)
  }

  submitAnswer(clientId, option) {
    const entry = this.playerRooms.get(clientId)
    if (!entry) {
      throw new Error('Player not found.')
    }
    const room = this.rooms.get(entry.code)
    const player = room.players.get(entry.playerId)
    if (room.phase !== 'question') {
      throw new Error('The game has not started yet.')
    }
    const options = this.optionsOf(room, room.index)
    if (typeof option !== 'string' || !options.includes(option)) {
      throw new Error('Invalid answer.')
    }
    // a short grace period keeps taps that land just after the deadline from being lost
    if (this.now() > room.deadline + ANSWER_GRACE_MS) {
      throw new Error('Time is up!')
    }
    this.consumeRate(clientId)

    player.answers.set(room.index, {
      option,
      // clamped to [0, 1] as a share of the question window for the speed bonus
      timeLeftMs: Math.max(0, Math.min(room.timerSeconds * 1000, room.deadline - this.now())),
    })
    this.emit(room.code, 'host', {
      type: 'answer-updated',
      playerId: entry.playerId,
      name: player.name,
      option,
      correct: option === room.questions[room.index].correct_answer,
    })
    // broadcast how many players have answered so far so others can see live progress
    this.emit(room.code, 'players', {
      type: 'answer-progress',
      answeredCount: this.answeredCount(room),
      totalPlayers: room.players.size,
    })
    // notify everyone when the last pending player has answered, so they can reveal
    if (room.players.size > 0 && room.players.size === this.answeredCount(room)) {
      this.emit(room.code, 'all', {
        type: 'all-answered',
        correctAnswer: room.questions[room.index].correct_answer,
        scoreboard: buildScoreboard(room),
      })
    }
  }

  answeredCount(room) {
    let count = 0
    for (const player of room.players.values()) {
      if (player.answers.has(room.index)) count++
    }
    return count
  }

  nextQuestion(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'question') {
      throw new Error('There is no active question.')
    }
    // host force-skipped before timer ran out and before everyone answered —
    // give players a brief reveal of the correct answer before moving on
    const allDone = room.players.size > 0 && room.players.size === this.answeredCount(room)
    const timedOut = this.now() > room.deadline
    if (!allDone && !timedOut) {
      this.emit(room.code, 'all', {
        type: 'all-answered',
        correctAnswer: room.questions[room.index].correct_answer,
        scoreboard: buildScoreboard(room),
      })
      this.scheduleAdvance(room, FORCE_REVEAL_MS)
      return
    }
    this.advanceFromQuestion(room)
  }

  advanceFromQuestion(room) {
    const nextIndex = room.index + 1
    if (nextIndex < room.questions.length) {
      this.startQuestion(room, nextIndex)
    } else {
      room.phase = 'finished'
      this.emit(room.code, 'all', { type: 'game-finished', leaderboard: this.leaderboard(room) })
    }
  }

  // Host takes a finished room back to the lobby so new players can join with
  // the same room code and the host can rematch with the same questions.
  // Roster and playerIds are kept; per-round state is cleared, ready reset.
  backToLobby(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'finished') {
      throw new Error('Can only return to the lobby after a finished game.')
    }
    room.phase = 'lobby'
    room.index = -1
    room.deadline = 0
    room.countdownDeadline = 0
    room.pendingAdvance = null
    room.hostStatus = 'waiting-to-start'
    for (const player of room.players.values()) {
      player.answers.clear()
      player.ready = false
    }
    this.emit(room.code, 'all', {
      type: 'room-to-lobby',
      players: this.playersOf(room),
      topic: room.topic,
      quizReady: room.quizReady,
    })
    this.broadcastHostStatus(room)
  }

  // Lobby group chat — relay only, nothing is stored server-side. Each client
  // keeps its own copy in localStorage so a refresh restores visible history.
  // Allowed in lobby + starting countdown so players can chat while waiting.
  sendChat(clientId, { id, text }) {
    const hostCode = this.hostRooms.get(clientId)
    const hostRoom = hostCode ? this.rooms.get(hostCode) : undefined
    let room = hostRoom && hostRoom.hostClientId === clientId ? hostRoom : undefined
    let sender = room !== undefined ? { senderId: clientId, name: 'Host', role: 'host' } : undefined
    if (sender === undefined) {
      const entry = this.playerRooms.get(clientId)
      const playerRoom = entry ? this.rooms.get(entry.code) : undefined
      const player = playerRoom ? playerRoom.players.get(entry.playerId) : undefined
      if (playerRoom === undefined || player === undefined) {
        throw new Error('Not in a room.')
      }
      room = playerRoom
      sender = { senderId: entry.playerId, name: player.name, role: 'player' }
    }
    if (room.phase !== 'lobby' && room.phase !== 'starting') {
      throw new Error('Chat is only available in the lobby.')
    }
    const trimmed = String(text ?? '').trim()
    if (trimmed === '') {
      throw new Error('Chat message is empty.')
    }
    if (trimmed.length > MAX_CHAT_LENGTH) {
      throw new Error(`Chat messages are limited to ${MAX_CHAT_LENGTH} characters.`)
    }
    this.consumeRate(clientId)
    this.emit(room.code, 'all', {
      type: 'chat-received',
      id: String(id ?? '').slice(0, MAX_CHAT_ID_LENGTH),
      senderId: sender.senderId,
      name: sender.name,
      role: sender.role,
      text: trimmed,
      at: this.now(),
    })
  }

  // Host changed the setup (topic, difficulty, ...) after going back to the
  // lobby. Replaces the room's quiz content in place — same room code and
  // roster — and stays in the lobby so the host can Start when ready.
  // Ready is reset because the quiz changed; players must re-ready.
  updateRoomQuiz(clientId, { topic, timerSeconds, maxPlayers, questions }) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'lobby') {
      throw new Error('Questions can only be updated from the lobby.')
    }
    assertValidSettings({ timerSeconds, maxPlayers })
    assertValidQuestions(questions)
    if (maxPlayers < room.players.size) {
      throw new Error('New limit is below the current player count.')
    }
    room.topic = String(topic ?? '').slice(0, MAX_TOPIC_LENGTH)
    room.timerSeconds = timerSeconds
    room.maxPlayers = maxPlayers
    room.questions = questions
    room.quizReady = true
    room.hostStatus = 'waiting-to-start'
    room.hostDetail = ''
    room.index = -1
    room.deadline = 0
    room.pendingAdvance = null
    for (const player of room.players.values()) {
      player.answers.clear()
      player.ready = false
    }
    this.emit(room.code, 'all', {
      type: 'room-to-lobby',
      players: this.playersOf(room),
      topic: room.topic,
      quizReady: true,
    })
    this.broadcastHostStatus(room)
  }

  scheduleAdvance(room, delayMs) {
    room.pendingAdvance = { scheduledAt: this.now(), delayMs }
  }

  // Driven by now() so unit tests can advance time deterministically.
  // Called from sweep(); or directly when a host action needs an immediate check.
  processAdvances(nowMs = this.now()) {
    for (const room of this.rooms.values()) {
      if (!room.pendingAdvance) continue
      if (nowMs - room.pendingAdvance.scheduledAt < room.pendingAdvance.delayMs) continue
      room.pendingAdvance = null
      if (room.phase === 'starting') {
        this.startQuestion(room, 0)
      } else if (room.phase === 'question') {
        this.advanceFromQuestion(room)
      }
    }
  }

  closeRoom(clientId) {
    const room = this.roomOfHost(clientId)
    this.emit(room.code, 'all', { type: 'game-closed' })
    this.deleteRoom(room)
  }

  hostDisconnected(clientId) {
    const code = this.hostRooms.get(clientId)
    if (!code) return
    const room = this.rooms.get(code)
    if (!room) {
      this.hostRooms.delete(clientId)
      return
    }
    // keep room for HOST_GRACE_MS so host can rejoin via Wake Lock / screen-off.
    // Players are told immediately with an absolute expiry so their waiting
    // countdown can't drift (computed as expiresAt - now on redraw/focus).
    this.hostRooms.delete(clientId)
    room.hostClientId = null
    room.hostDisconnectedAt = this.now()
    this.emit(room.code, 'players', {
      type: 'host-disconnected',
      expiresAt: this.hostOfflineExpiresAt(room),
    })
  }

  /**
   * Token-verified host rebind. A valid secret always wins: any ghost socket
   * still bound to the room is displaced so authority can never overlap.
   */
  rejoinHost(clientId, code, secret) {
    const roomCode = String(code).trim().toUpperCase()
    const room = this.rooms.get(roomCode)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', 'Room not found. Check the code and try again.')
    }
    if (!secretMatches(room.hostSecretHash, secret)) {
      if (room.hostClientId) {
        throw new RoomError('HOST_ALREADY_CONNECTED', 'Host already connected.')
      }
      throw new RoomError(
        'SESSION_VERIFY_FAILED',
        "Couldn't verify the host session. Please create a new room.",
      )
    }
    if (room.hostDisconnectedAt != null && this.now() - room.hostDisconnectedAt > HOST_GRACE_MS) {
      this.deleteRoom(room)
      throw new RoomError(
        'REJOIN_WINDOW_EXPIRED',
        'Host rejoin window expired (3 minutes). Room closed.',
      )
    }
    const displaced = []
    if (room.hostClientId && room.hostClientId !== clientId) {
      displaced.push(room.hostClientId)
      this.hostRooms.delete(room.hostClientId)
    }
    const hostSecret = newSecret()
    room.hostSecretHash = hashSecret(hostSecret)
    room.hostClientId = clientId
    room.hostDisconnectedAt = null
    this.hostRooms.set(clientId, roomCode)
    // sync full state to the rebound host, then tell players authority is back
    const sync = this.buildStateSync(room, null)
    sync.hostSecret = hostSecret
    this.emit(roomCode, 'host', sync, clientId)
    if (room.phase === 'question') {
      // replay live answers so host sees who answered
      for (const [playerId, player] of room.players) {
        const ans = player.answers.get(room.index)
        if (ans) {
          this.emit(
            roomCode,
            'host',
            {
              type: 'answer-updated',
              playerId,
              name: player.name,
              option: ans.option,
              correct: ans.option === room.questions[room.index].correct_answer,
            },
            clientId,
          )
        }
      }
    }
    this.broadcastHostStatus(room)
    return { code: roomCode, hostSecret, displaced }
  }

  playerDisconnected(clientId) {
    const entry = this.playerRooms.get(clientId)
    if (!entry) {
      return
    }
    const room = this.rooms.get(entry.code)
    if (!room) {
      this.playerRooms.delete(clientId)
      return
    }
    const player = room.players.get(entry.playerId)
    if (player) {
      player.clientId = null
      player.disconnectedAt = this.now()
    }
    this.playerRooms.delete(clientId)
    // keep slot for grace; broadcast so host sees offline state (ready kept)
    if (room.phase === 'lobby' || room.phase === 'starting') {
      this.broadcastRoster(room)
    }
  }

  /**
   * Intentional exit (Leave button / tab close beacon) from a live socket.
   * Unlike a dirty drop, the seat is freed immediately — no 5-minute hold —
   * so intentional leavers never squat on maxPlayers seats or the ready gate.
   * Host tabs keep their grace (a refresh must not nuke the room).
   */
  clientExit(clientId) {
    const entry = this.playerRooms.get(clientId)
    if (!entry) {
      return { removed: false }
    }
    const room = this.rooms.get(entry.code)
    this.playerRooms.delete(clientId)
    if (!room) {
      return { removed: false }
    }
    const player = room.players.get(entry.playerId)
    if (!player) {
      return { removed: false }
    }
    room.players.delete(entry.playerId)
    this.broadcastRoster(room)
    return { removed: true, code: room.code, playerId: entry.playerId }
  }

  /**
   * Beacon path for tab-close (no live socket): verifies the resume secret,
   * then frees the seat exactly like clientExit. Host beacons are ignored so
   * a host refresh never destroys the room.
   */
  leaveSeat(code, playerId, secret) {
    const room = this.rooms.get(String(code).trim().toUpperCase())
    if (!room) {
      return { removed: false }
    }
    const player = room.players.get(playerId)
    if (!player || !secretMatches(player.secretHash, secret)) {
      return { removed: false }
    }
    for (const [cid, entry] of Array.from(this.playerRooms)) {
      if (entry.code === room.code && entry.playerId === playerId) {
        this.playerRooms.delete(cid)
      }
    }
    room.players.delete(playerId)
    this.broadcastRoster(room)
    return { removed: true, code: room.code, playerId }
  }

  /**
   * Token-verified rejoin. The presented secret must match the seat's stored
   * hash; on success the secret rotates (old tabs can't fight the live one)
   * and any stale socket still bound to the seat is displaced. Works in every
   * phase — the client hydrates from a single atomic state-sync.
   */
  rejoin(clientId, code, playerId, name, secret) {
    const roomCode = String(code).trim().toUpperCase()
    const room = this.rooms.get(roomCode)
    if (!room) {
      throw new RoomError('ROOM_NOT_FOUND', 'Room not found. Check the code and try again.')
    }
    const trimmedName = String(name ?? '').trim()
    // an oversized name would be stored and broadcast in every roster
    if (trimmedName.length > MAX_NAME_LENGTH) {
      throw new RoomError(
        'NAME_INVALID',
        `A player name is required (1-${MAX_NAME_LENGTH} characters).`,
      )
    }
    const player = room.players.get(playerId)
    if (player && secretMatches(player.secretHash, secret)) {
      if (player.disconnectedAt != null && this.now() - player.disconnectedAt > PLAYER_GRACE_MS) {
        room.players.delete(playerId)
        throw new RoomError(
          'REJOIN_WINDOW_EXPIRED',
          'Rejoin window expired (5 minutes). Please join as a new player.',
        )
      }
      return this.attachSeat(room, playerId, player, clientId, trimmedName)
    }
    if (player) {
      throw new RoomError(
        'SESSION_VERIFY_FAILED',
        "Couldn't verify your previous session. Please join as a new player.",
      )
    }
    // Fallback: same-name reclaim for token-less clients (new device, lost id).
    // Lobby/starting only — mid-game return requires the resume token so a
    // stranger can't walk into a live game under someone else's name.
    if (room.phase === 'lobby' || room.phase === 'starting') {
      for (const [pid, p] of room.players) {
        if (p.name === trimmedName && p.clientId === null) {
          if (p.disconnectedAt != null && this.now() - p.disconnectedAt > PLAYER_GRACE_MS) {
            room.players.delete(pid)
            continue
          }
          return this.attachSeat(room, pid, p, clientId, trimmedName)
        }
      }
    }
    throw new RoomError(
      'NO_PENDING_SLOT',
      'No pending slot for rejoin. Please join as new player with a different code.',
    )
  }

  /**
   * Binds a socket to a seat: clears stale mappings, mints a fresh secret,
   * notifies the room, and delivers one atomic state-sync to the returner.
   */
  attachSeat(room, playerId, player, clientId, trimmedName) {
    const displaced = []
    // drop every stale socket mapping for this seat (ghost authority overlap:
    // a half-open old socket must never share the seat with the live one)
    for (const [cid, entry] of Array.from(this.playerRooms)) {
      if (entry.code === room.code && entry.playerId === playerId && cid !== clientId) {
        this.playerRooms.delete(cid)
        displaced.push(cid)
      }
    }
    const resumeSecret = newSecret()
    player.secretHash = hashSecret(resumeSecret)
    player.clientId = clientId
    player.disconnectedAt = null
    if (trimmedName) player.name = trimmedName
    this.playerRooms.set(clientId, { code: room.code, playerId })
    this.broadcastRoster(room)
    const sync = this.buildStateSync(room, playerId)
    sync.resumeSecret = resumeSecret
    sync.resumeTtlMs = PLAYER_GRACE_MS
    this.emit(room.code, playerId, sync, clientId)
    return { code: room.code, playerId, resumeSecret, displaced }
  }

  sweep(nowMs = this.now()) {
    this.processAdvances(nowMs)
    const removed = []
    for (const room of this.rooms.values()) {
      // host grace expiry — notify players then delete
      if (
        room.hostClientId === null &&
        room.hostDisconnectedAt != null &&
        nowMs - room.hostDisconnectedAt > HOST_GRACE_MS
      ) {
        this.emit(room.code, 'players', { type: 'host-left' })
        this.deleteRoom(room)
        removed.push(room.code)
        continue
      }
      // player grace expiry
      let rosterChanged = false
      for (const [pid, player] of Array.from(room.players)) {
        if (
          player.clientId === null &&
          player.disconnectedAt != null &&
          nowMs - player.disconnectedAt > PLAYER_GRACE_MS
        ) {
          room.players.delete(pid)
          rosterChanged = true
          for (const [cid, entry] of this.playerRooms) {
            if (entry.playerId === pid) this.playerRooms.delete(cid)
          }
        }
      }
      if (rosterChanged) {
        this.broadcastRoster(room)
      }
      if (nowMs - room.createdAt > MAX_IDLE_MS) {
        this.deleteRoom(room)
        if (!removed.includes(room.code)) removed.push(room.code)
      }
    }
    // drop rate buckets for clients that no longer hold a room role
    for (const clientId of this.messageBudgets.keys()) {
      if (!this.playerRooms.has(clientId) && !this.hostRooms.has(clientId)) {
        this.messageBudgets.delete(clientId)
      }
    }
    return removed
  }

  startQuestion(room, index) {
    room.phase = 'question'
    room.hostStatus = 'started'
    room.index = index
    room.countdownDeadline = 0
    room.deadline = this.now() + room.timerSeconds * 1000
    const payload = {
      type: 'question-started',
      index,
      total: room.questions.length,
      question: room.questions[index].question,
      options: this.optionsOf(room, index),
      timerSeconds: room.timerSeconds,
      deadline: room.deadline,
      scoreboard: buildScoreboard(room),
    }
    // The answer ships only to the host; players see it at reveal time
    // (all-answered / force-skip), never while the question is open.
    this.emit(room.code, 'host', {
      ...payload,
      correctAnswer: room.questions[index].correct_answer,
    })
    this.emit(room.code, 'players', payload)
    this.broadcastHostStatus(room)
  }

  optionsOf(room, index) {
    const q = room.questions[index]
    return [...q.incorrect_answers, q.correct_answer]
  }

  playersOf(room) {
    return [...room.players.entries()].map(([playerId, player]) => ({
      playerId,
      name: player.name,
      ready: Boolean(player.ready),
      connected: player.clientId !== null,
      // absolute expiry for offline seats so clients count down from server
      // truth (expiresAt - now) instead of drifting local timers
      expiresAt:
        player.clientId !== null || player.disconnectedAt == null
          ? null
          : player.disconnectedAt + PLAYER_GRACE_MS,
    }))
  }

  broadcastRoster(room) {
    const players = this.playersOf(room)
    this.emit(room.code, 'players', { type: 'lobby-updated', players, quizReady: room.quizReady })
    this.emit(room.code, 'host', { type: 'lobby-updated', players, quizReady: room.quizReady })
  }

  broadcastHostStatus(room) {
    this.emit(room.code, 'all', {
      type: 'host-status-updated',
      status: room.hostStatus,
      detail: room.hostDetail ?? '',
      topic: room.topic,
      hostOnline: room.hostClientId !== null,
      hostOfflineExpiresAt: this.hostOfflineExpiresAt(room),
    })
  }

  leaderboard(room) {
    const entries = []
    for (const player of room.players.values()) {
      let correct = 0
      let score = 0
      let timeSpentMs = 0
      for (let i = 0; i < room.questions.length; i++) {
        const answer = player.answers.get(i)
        if (answer && answer.option === room.questions[i].correct_answer) {
          correct++
          const ratio = answer.timeLeftMs / (room.timerSeconds * 1000)
          // millisecond-resolution points (5000-10000 per question) keep ties rare
          score += Math.round(1000 * (POINTS_MIN + (POINTS_BASE - POINTS_MIN) * ratio))
        }
      }
      for (const answer of player.answers.values()) {
        // recorded time spent only counts answered questions (early = less time)
        timeSpentMs += room.timerSeconds * 1000 - answer.timeLeftMs
      }
      entries.push({
        name: player.name,
        score,
        correct,
        total: room.questions.length,
        timeSpentMs,
      })
    }
    entries.sort(
      (a, b) => b.score - a.score || a.timeSpentMs - b.timeSpentMs || a.name.localeCompare(b.name),
    )
    return entries
  }

  roomOfHost(clientId) {
    const code = this.hostRooms.get(clientId)
    if (!code || !this.rooms.has(code)) {
      throw new Error('Only the host can do that.')
    }
    return this.rooms.get(code)
  }

  nextCode() {
    let code
    do {
      code = Array.from(
        { length: CODE_LENGTH },
        // crypto-grade randomness: the code is the only gate for joining
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('')
    } while (this.rooms.has(code))
    return code
  }

  deleteRoom(room) {
    this.rooms.delete(room.code)
    if (room.hostClientId) this.hostRooms.delete(room.hostClientId)
    for (const player of room.players.values()) {
      if (player.clientId) this.playerRooms.delete(player.clientId)
    }
    // also clear any stale playerRooms entries for disconnected grace players
    const toDelete = []
    for (const [cid, entry] of this.playerRooms) {
      if (entry.code === room.code) toDelete.push(cid)
    }
    for (const cid of toDelete) this.playerRooms.delete(cid)
  }
}
