const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const MAX_NAME_LENGTH = 24
const MAX_IDLE_MS = 2 * 60 * 60 * 1000
const ANSWER_GRACE_MS = 1500
const POINTS_BASE = 10
const POINTS_MIN = 5
const PLAYER_GRACE_MS = 90_000
const HOST_GRACE_MS = 60_000
const FORCE_REVEAL_MS = 3000
const MAX_CHAT_LENGTH = 200

/** Shared validation for host-supplied quiz content (error messages kept stable). */
function assertValidQuiz({ questions, timerSeconds, maxPlayers }) {
  const valid =
    Array.isArray(questions) &&
    questions.length > 0 &&
    questions.every(
      (q) =>
        typeof q.question === 'string' &&
        q.question !== '' &&
        typeof q.correct_answer === 'string' &&
        q.correct_answer !== '' &&
        Array.isArray(q.incorrect_answers) &&
        q.incorrect_answers.length >= 1,
    )
  if (!valid) {
    throw new Error('Invalid question set.')
  }
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) {
    throw new Error('Invalid timer setting.')
  }
  if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 100) {
    throw new Error('Max participants must be between 2 and 100.')
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
  }

  emit(code, to, message, clientId) {
    this.onSend({ to, message, code, clientId })
  }

  createRoom(clientId, { topic, timerSeconds, questions, maxPlayers }) {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('No quiz questions were generated. Please try again.')
    }
    const valid = questions.every(
      (q) =>
        typeof q.question === 'string' &&
        q.question !== '' &&
        typeof q.correct_answer === 'string' &&
        q.correct_answer !== '' &&
        Array.isArray(q.incorrect_answers) &&
        q.incorrect_answers.length >= 1,
    )
    if (!valid) {
      throw new Error('Invalid question set.')
    }
    if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) {
      throw new Error('Invalid timer setting.')
    }
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 100) {
      throw new Error('Max participants must be between 2 and 100.')
    }

    const code = this.nextCode()
    this.rooms.set(code, {
      code,
      hostClientId: clientId,
      hostDisconnectedAt: null,
      topic: String(topic ?? ''),
      timerSeconds,
      maxPlayers,
      questions,
      phase: 'lobby',
      index: -1,
      deadline: 0,
      players: new Map(),
      createdAt: this.now(),
    })
    this.hostRooms.set(clientId, code)
    this.emit(code, 'host', { type: 'room-created', code }, clientId)
    return { code }
  }

  /** Current-question snapshot so (re)joiners mid-game can play immediately. */
  syncQuestionTo(room, playerId, clientId) {
    this.emit(room.code, playerId, {
      type: 'question-started',
      index: room.index,
      total: room.questions.length,
      question: room.questions[room.index].question,
      options: this.optionsOf(room, room.index),
      timerSeconds: room.timerSeconds,
      deadline: room.deadline,
      correctAnswer: room.questions[room.index].correct_answer,
      scoreboard: buildScoreboard(room),
    }, clientId)
  }

  joinRoom(clientId, code, name) {
    const room = this.rooms.get(String(code).trim().toUpperCase())
    if (!room) {
      throw new Error('Room not found. Check the code and try again.')
    }
    // Idempotent retry: this socket already holds a slot here (auto-rejoin
    // followed by the flushed join after a refresh, double-tapped Join,
    // lost-response retry). Minting another would duplicate the same user.
    const existing = this.playerRooms.get(clientId)
    if (existing && existing.code === room.code) {
      const held = room.players.get(existing.playerId)
      if (held) {
        held.clientId = clientId
        held.disconnectedAt = null
        const players = this.playersOf(room)
        this.emit(room.code, existing.playerId, { type: 'joined', playerId: existing.playerId, name: held.name, roomCode: room.code, players }, clientId)
        this.broadcastRoster(room)
        if (room.phase === 'question') {
          this.syncQuestionTo(room, existing.playerId, clientId)
        } else if (room.phase === 'finished') {
          this.emit(room.code, existing.playerId, { type: 'game-finished', leaderboard: this.leaderboard(room) }, clientId)
        }
        return { code: room.code, playerId: existing.playerId }
      }
    }
    // Late joiners are admitted while a question is running (missed questions
    // score nothing) so a dropped player can always come back mid-game.
    if (room.phase !== 'lobby' && room.phase !== 'question') {
      throw new Error('The game has already started.')
    }
    const trimmed = String(name ?? '').trim()
    if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(`A player name is required (1-${MAX_NAME_LENGTH} characters).`)
    }
    // same-name reclaim within grace (covers screen-off without playerId)
    for (const [pid, p] of room.players) {
      if (p.name === trimmed && p.clientId === null) {
        if (p.disconnectedAt != null && this.now() - p.disconnectedAt > PLAYER_GRACE_MS) {
          room.players.delete(pid)
          continue
        }
        p.clientId = clientId
        p.disconnectedAt = null
        this.playerRooms.set(clientId, { code: room.code, playerId: pid })
        const players = this.playersOf(room)
        this.emit(room.code, pid, { type: 'joined', playerId: pid, name: p.name, roomCode: room.code, players }, clientId)
        this.broadcastRoster(room)
        if (room.phase === 'question') {
          this.syncQuestionTo(room, pid, clientId)
        }
        return { code: room.code, playerId: pid }
      }
    }
    if (room.players.size >= room.maxPlayers) {
      throw new Error('This room is full.')
    }

    const playerId = `p-${++this.playerSeq}`
    room.players.set(playerId, { clientId, name: trimmed, answers: new Map(), disconnectedAt: null })
    this.playerRooms.set(clientId, { code: room.code, playerId })
    const players = this.playersOf(room)
    this.emit(
      room.code,
      playerId,
      { type: 'joined', playerId, name: trimmed, roomCode: room.code, players },
      clientId,
    )
    this.broadcastRoster(room)
    if (room.phase === 'question') {
      this.syncQuestionTo(room, playerId, clientId)
    }
    return { code: room.code, playerId }
  }

  startGame(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'lobby') {
      throw new Error('The game has already started.')
    }
    if (room.players.size === 0) {
      throw new Error('Add at least one player before starting.')
    }
    this.startQuestion(room, 0)
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
  // Roster and playerIds are kept; per-round state is cleared.
  backToLobby(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'finished') {
      throw new Error('Can only return to the lobby after a finished game.')
    }
    room.phase = 'lobby'
    room.index = -1
    room.deadline = 0
    room.pendingAdvance = null
    for (const player of room.players.values()) {
      player.answers.clear()
    }
    this.emit(room.code, 'all', {
      type: 'room-to-lobby',
      players: this.playersOf(room),
      topic: room.topic,
    })
  }

  // Lobby group chat — relay only, nothing is stored server-side. Each client
  // keeps its own copy in localStorage so a refresh restores visible history.
  // Restricted to the lobby so answers can't be shared mid-game.
  sendChat(clientId, { id, text }) {
    const hostCode = this.hostRooms.get(clientId)
    const hostRoom = hostCode ? this.rooms.get(hostCode) : undefined
    let room = hostRoom && hostRoom.hostClientId === clientId ? hostRoom : undefined
    let sender =
      room !== undefined ? { senderId: clientId, name: 'Host', role: 'host' } : undefined
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
    if (room.phase !== 'lobby') {
      throw new Error('Chat is only available in the lobby.')
    }
    const trimmed = String(text ?? '').trim()
    if (trimmed === '') {
      throw new Error('Chat message is empty.')
    }
    if (trimmed.length > MAX_CHAT_LENGTH) {
      throw new Error(`Chat messages are limited to ${MAX_CHAT_LENGTH} characters.`)
    }
    this.emit(room.code, 'all', {
      type: 'chat-received',
      id: String(id ?? ''),
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
  updateRoomQuiz(clientId, { topic, timerSeconds, maxPlayers, questions }) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'lobby') {
      throw new Error('Questions can only be updated from the lobby.')
    }
    assertValidQuiz({ questions, timerSeconds, maxPlayers })
    room.topic = String(topic ?? '')
    room.timerSeconds = timerSeconds
    room.maxPlayers = maxPlayers
    room.questions = questions
    room.index = -1
    room.deadline = 0
    room.pendingAdvance = null
    for (const player of room.players.values()) {
      player.answers.clear()
    }
    this.emit(room.code, 'all', {
      type: 'room-to-lobby',
      players: this.playersOf(room),
      topic: room.topic,
    })
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
      if (room.phase === 'question') {
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
    // keep room for HOST_GRACE_MS so host can rejoin via Wake Lock / screen-off
    this.hostRooms.delete(clientId)
    room.hostClientId = null
    room.hostDisconnectedAt = this.now()
    // do not emit host-left immediately — give host 60s to rejoin; players will see reconnect window
    // actual deletion handled lazily on rejoin attempt / next host action / sweep
  }

  rejoinHost(clientId, code) {
    const roomCode = String(code).trim().toUpperCase()
    const room = this.rooms.get(roomCode)
    if (!room) {
      throw new Error('Room not found. Check the code and try again.')
    }
    if (room.hostClientId) {
      throw new Error('Host already connected.')
    }
    if (room.hostDisconnectedAt != null && this.now() - room.hostDisconnectedAt > HOST_GRACE_MS) {
      this.deleteRoom(room)
      throw new Error('Host grace period expired. Room closed.')
    }
    room.hostClientId = clientId
    room.hostDisconnectedAt = null
    this.hostRooms.set(clientId, roomCode)
    // sync current state to rejoined host
    this.emit(roomCode, 'host', { type: 'room-created', code: roomCode }, clientId)
    if (room.phase === 'lobby') {
      this.broadcastRoster(room)
    } else if (room.phase === 'question') {
      this.emit(roomCode, 'host', {
        type: 'question-started',
        index: room.index,
        total: room.questions.length,
        question: room.questions[room.index].question,
        options: this.optionsOf(room, room.index),
        timerSeconds: room.timerSeconds,
        deadline: room.deadline,
        correctAnswer: room.questions[room.index].correct_answer,
        scoreboard: buildScoreboard(room),
      }, clientId)
      // replay live answers so host sees who answered
      for (const [playerId, player] of room.players) {
        const ans = player.answers.get(room.index)
        if (ans) {
          this.emit(roomCode, 'host', {
            type: 'answer-updated',
            playerId,
            name: player.name,
            option: ans.option,
            correct: ans.option === room.questions[room.index].correct_answer,
          }, clientId)
        }
      }
    } else if (room.phase === 'finished') {
      this.emit(roomCode, 'host', { type: 'game-finished', leaderboard: this.leaderboard(room) }, clientId)
    }
    return { code: roomCode }
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
    // keep player in room for PLAYER_GRACE_MS; do not broadcast removal yet — allows same-name reclaim
  }

  rejoin(clientId, code, playerId, name) {
    const roomCode = String(code).trim().toUpperCase()
    const room = this.rooms.get(roomCode)
    if (!room) {
      throw new Error('Room not found. Check the code and try again.')
    }
    const trimmedName = String(name ?? '').trim()
    // try by playerId first (most secure)
    let player = room.players.get(playerId)
    if (player?.clientId === null && player.disconnectedAt != null && this.now() - player.disconnectedAt > PLAYER_GRACE_MS) {
      // slot expired — drop it and fall through to the late-join path below
      room.players.delete(playerId)
      player = undefined
    }
    if (player && player.clientId === null) {
      player.clientId = clientId
      player.disconnectedAt = null
      if (trimmedName) player.name = trimmedName
      this.playerRooms.set(clientId, { code: roomCode, playerId })
      const players = this.playersOf(room)
      this.emit(roomCode, playerId, { type: 'joined', playerId, name: player.name, roomCode, players }, clientId)
      this.broadcastRoster(room)
      // sync current question if game in progress
      if (room.phase === 'question') {
        this.syncQuestionTo(room, playerId, clientId)
      } else if (room.phase === 'finished') {
        this.emit(roomCode, playerId, { type: 'game-finished', leaderboard: this.leaderboard(room) }, clientId)
      }
      return { code: roomCode, playerId }
    }
    // fallback: same name reclaim within grace (covers new device / lost playerId)
    for (const [pid, p] of room.players) {
      if (p.name === trimmedName && p.clientId === null) {
        if (p.disconnectedAt != null && this.now() - p.disconnectedAt > PLAYER_GRACE_MS) {
          room.players.delete(pid)
          continue
        }
        p.clientId = clientId
        p.disconnectedAt = null
        this.playerRooms.set(clientId, { code: roomCode, playerId: pid })
        const players = this.playersOf(room)
        this.emit(roomCode, pid, { type: 'joined', playerId: pid, name: p.name, roomCode, players }, clientId)
        this.broadcastRoster(room)
        if (room.phase === 'question') {
          this.syncQuestionTo(room, pid, clientId)
        } else if (room.phase === 'finished') {
          this.emit(roomCode, pid, { type: 'game-finished', leaderboard: this.leaderboard(room) }, clientId)
        }
        return { code: roomCode, playerId: pid }
      }
    }
    // No slot to reclaim (grace expired or entry swept): admit as a late
    // joiner while the game is still running so a mid-game drop always has a
    // way back in. Missed questions score nothing.
    if (room.phase === 'finished') {
      throw new Error('The game has already started.')
    }
    if (trimmedName === '' || trimmedName.length > MAX_NAME_LENGTH) {
      throw new Error('No pending slot for rejoin. Please join as new player.')
    }
    if (room.players.size >= room.maxPlayers) {
      throw new Error('This room is full.')
    }
    const lateId = `p-${++this.playerSeq}`
    room.players.set(lateId, { clientId, name: trimmedName, answers: new Map(), disconnectedAt: null })
    this.playerRooms.set(clientId, { code: roomCode, playerId: lateId })
    const latePlayers = this.playersOf(room)
    this.emit(roomCode, lateId, { type: 'joined', playerId: lateId, name: trimmedName, roomCode, players: latePlayers }, clientId)
    this.broadcastRoster(room)
    if (room.phase === 'question') {
      this.syncQuestionTo(room, lateId, clientId)
    }
    return { code: roomCode, playerId: lateId }
  }

  sweep(nowMs = this.now()) {
    this.processAdvances(nowMs)
    const removed = []
    for (const room of this.rooms.values()) {
      // host grace expiry — notify players then delete
      if (room.hostClientId === null && room.hostDisconnectedAt != null && nowMs - room.hostDisconnectedAt > HOST_GRACE_MS) {
        this.emit(room.code, 'players', { type: 'host-left' })
        this.deleteRoom(room)
        removed.push(room.code)
        continue
      }
      // player grace expiry
      let rosterChanged = false
      for (const [pid, player] of Array.from(room.players)) {
        if (player.clientId === null && player.disconnectedAt != null && nowMs - player.disconnectedAt > PLAYER_GRACE_MS) {
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
    return removed
  }

  startQuestion(room, index) {
    room.phase = 'question'
    room.index = index
    room.deadline = this.now() + room.timerSeconds * 1000
    this.emit(room.code, 'all', {
      type: 'question-started',
      index,
      total: room.questions.length,
      question: room.questions[index].question,
      options: this.optionsOf(room, index),
      timerSeconds: room.timerSeconds,
      deadline: room.deadline,
      correctAnswer: room.questions[index].correct_answer,
      scoreboard: buildScoreboard(room),
    })
  }

  optionsOf(room, index) {
    const q = room.questions[index]
    return [...q.incorrect_answers, q.correct_answer]
  }

  playersOf(room) {
    return [...room.players.entries()].map(([playerId, player]) => ({
      playerId,
      name: player.name,
    }))
  }

  broadcastRoster(room) {
    const players = this.playersOf(room)
    this.emit(room.code, 'players', { type: 'lobby-updated', players })
    this.emit(room.code, 'host', { type: 'lobby-updated', players })
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
        () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
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
