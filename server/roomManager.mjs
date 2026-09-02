const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const MAX_NAME_LENGTH = 24
const MAX_IDLE_MS = 2 * 60 * 60 * 1000
const ANSWER_GRACE_MS = 1500
const POINTS_BASE = 10
const POINTS_MIN = 5

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

  joinRoom(clientId, code, name) {
    const room = this.rooms.get(String(code).trim().toUpperCase())
    if (!room) {
      throw new Error('Room not found. Check the code and try again.')
    }
    if (room.phase !== 'lobby') {
      throw new Error('The game has already started.')
    }
    if (room.players.size >= room.maxPlayers) {
      throw new Error('This room is full.')
    }
    const trimmed = String(name ?? '').trim()
    if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) {
      throw new Error(`A player name is required (1-${MAX_NAME_LENGTH} characters).`)
    }

    const playerId = `p-${++this.playerSeq}`
    room.players.set(playerId, { clientId, name: trimmed, answers: new Map() })
    this.playerRooms.set(clientId, { code: room.code, playerId })
    const players = this.playersOf(room)
    this.emit(
      room.code,
      playerId,
      { type: 'joined', playerId, name: trimmed, roomCode: room.code, players },
      clientId,
    )
    this.broadcastRoster(room)
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
  }

  nextQuestion(clientId) {
    const room = this.roomOfHost(clientId)
    if (room.phase !== 'question') {
      throw new Error('There is no active question.')
    }
    const nextIndex = room.index + 1
    if (nextIndex < room.questions.length) {
      this.startQuestion(room, nextIndex)
    } else {
      room.phase = 'finished'
      this.emit(room.code, 'all', { type: 'game-finished', leaderboard: this.leaderboard(room) })
    }
  }

  closeRoom(clientId) {
    const room = this.roomOfHost(clientId)
    this.emit(room.code, 'all', { type: 'game-closed' })
    this.deleteRoom(room)
  }

  hostDisconnected(clientId) {
    const room = this.roomOfHost(clientId)
    this.emit(room.code, 'players', { type: 'host-left' })
    this.deleteRoom(room)
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
    room.players.delete(entry.playerId)
    this.playerRooms.delete(clientId)
    this.broadcastRoster(room)
  }

  sweep(nowMs = this.now()) {
    const removed = []
    for (const room of this.rooms.values()) {
      if (nowMs - room.createdAt > MAX_IDLE_MS) {
        this.deleteRoom(room)
        removed.push(room.code)
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
    this.hostRooms.delete(room.hostClientId)
    for (const player of room.players.values()) {
      this.playerRooms.delete(player.clientId)
    }
  }
}
