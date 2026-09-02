import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RoomManager } from './roomManager.mjs'

const NOW = 1_000_000
const TIMER = 15

function makeQuestion(text, correct = 'C') {
  return { question: text, correct_answer: correct, incorrect_answers: ['A', 'B', 'D'] }
}

function makeQuestions(count) {
  return Array.from({ length: count }, (_, i) => makeQuestion(`Q${i + 1}`))
}

function makeHarness({ now = () => NOW } = {}) {
  const sends = []
  const manager = new RoomManager({ now, onSend: (event) => sends.push(event) })
  return { manager, sends }
}

function sentTo(sends, to) {
  return sends.filter((s) => s.to === to).map((s) => s.message)
}

function lastSentTo(sends, to) {
  const messages = sentTo(sends, to)
  return messages[messages.length - 1]
}

test('createRoom returns a unique 6-char code and notifies the host', () => {
  const { manager, sends } = makeHarness()

  const first = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })
  const second = manager.createRoom('host-2', {
    topic: 'Cats',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })

  assert.match(first.code, /^[A-Z2-9]{6}$/)
  assert.match(second.code, /^[A-Z2-9]{6}$/)
  assert.notEqual(first.code, second.code)
  const hostMessages = sentTo(sends, 'host')
  assert.deepEqual(hostMessages[0], { type: 'room-created', code: first.code })
  assert.deepEqual(hostMessages[1], { type: 'room-created', code: second.code })
})

test('createRoom rejects empty question sets', () => {
  const { manager } = makeHarness()
  assert.throws(
    () =>
      manager.createRoom('host-1', {
        topic: 'JS',
        timerSeconds: TIMER,
        maxPlayers: 10,
        questions: [],
      }),
    /questions/i,
  )
})

test('join sends joined to the player and lobby-updated to everyone', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })

  const { playerId } = manager.joinRoom('player-1', code, 'Ana')

  assert.match(playerId, /^p-/)
  assert.deepEqual(lastSentTo(sends, playerId), {
    type: 'joined',
    playerId,
    name: 'Ana',
    roomCode: code,
    players: [{ playerId, name: 'Ana' }],
  })
  assert.deepEqual(sentTo(sends, 'players')[0], {
    type: 'lobby-updated',
    players: [{ playerId, name: 'Ana' }],
  })
  assert.deepEqual(lastSentTo(sends, 'host'), {
    type: 'lobby-updated',
    players: [{ playerId, name: 'Ana' }],
  })
})

test('join rejects unknown room codes and blank or oversized names', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })

  assert.throws(() => manager.joinRoom('player-1', 'ZZZZZZ', 'Ana'), /not found/i)
  assert.throws(() => manager.joinRoom('player-1', code, '   '), /name/i)
  assert.throws(() => manager.joinRoom('player-1', code, 'x'.repeat(25)), /name/i)
})

test('duplicate names in a room are allowed (players are id-distinguished)', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })

  const first = manager.joinRoom('player-1', code, 'Ana')
  const second = manager.joinRoom('player-2', code, 'Ana')

  assert.notEqual(first.playerId, second.playerId)
})

test('startGame requires a host, players, and the lobby phase', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })

  assert.throws(() => manager.startGame('stranger'), /host/i)
  assert.throws(() => manager.startGame('host-1'), /player/i)
  manager.joinRoom('player-1', code, 'Ana')
  manager.startGame('host-1')
  assert.throws(() => manager.startGame('host-1'), /started/i)
})

test('startGame broadcasts question-started with canonical options and a server deadline', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })
  manager.joinRoom('player-1', code, 'Ana')

  manager.startGame('host-1')

  assert.deepEqual(lastSentTo(sends, 'all'), {
    type: 'question-started',
    index: 0,
    total: 3,
    question: 'Q1',
    options: ['A', 'B', 'D', 'C'],
    timerSeconds: TIMER,
    deadline: NOW + TIMER * 1000,
    correctAnswer: 'C',
  })
})

test('submitAnswer accepts fresh answers, stores the latest, and flags correctness to the host', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })
  const { playerId } = manager.joinRoom('player-1', code, 'Ana')
  manager.startGame('host-1')

  manager.submitAnswer('player-1', 'A')
  assert.deepEqual(lastSentTo(sends, 'host'), {
    type: 'answer-updated',
    playerId,
    name: 'Ana',
    option: 'A',
    correct: false,
  })

  manager.submitAnswer('player-1', 'C')
  assert.deepEqual(lastSentTo(sends, 'host'), {
    type: 'answer-updated',
    playerId,
    name: 'Ana',
    option: 'C',
    correct: true,
  })
})

test('submitAnswer rejects answers before the start, unknown options, and late answers', () => {
  let currentTime = NOW
  const { manager } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })
  manager.joinRoom('player-1', code, 'Ana')

  assert.throws(() => manager.submitAnswer('player-1', 'C'), /started/i)

  manager.startGame('host-1')
  manager.submitAnswer('player-1', 'C')
  manager.submitAnswer('player-1', 'A')
  assert.throws(() => manager.submitAnswer('player-1', 'Nope'), /invalid/i)

  // within the 1500ms grace a selected answer still counts (at the time floor)
  currentTime = NOW + TIMER * 1000 + 1000
  manager.submitAnswer('player-1', 'C')
  // beyond the grace window answers are rejected
  currentTime = NOW + TIMER * 1000 + 2000
  assert.throws(() => manager.submitAnswer('player-1', 'A'), /time/i)
})

test('answers inside the grace window score the no-speed floor', () => {
  let currentTime = NOW
  const { manager } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.startGame('host-1')

  // late but within the grace window: correct, so still 5 points (floor of the speed range)
  currentTime = NOW + TIMER * 1000 + 1000
  manager.submitAnswer('player-1', 'C')

  let finished
  manager.onSend = ({ message }) => (finished = message)
  manager.nextQuestion('host-1')
  assert.deepEqual(finished.leaderboard, [
    { name: 'Ana', score: 5000, correct: 1, total: 1, timeSpentMs: TIMER * 1000 },
  ])
})

test('nextQuestion advances through questions and finishes with a sorted leaderboard', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  manager.startGame('host-1')

  manager.submitAnswer('player-1', 'C')
  manager.submitAnswer('player-2', 'A')
  manager.nextQuestion('host-1')

  const second = lastSentTo(sends, 'all')
  assert.equal(second.type, 'question-started')
  assert.equal(second.index, 1)
  assert.equal(second.deadline, NOW + TIMER * 1000)

  manager.submitAnswer('player-1', 'A')
  manager.submitAnswer('player-2', 'C')
  manager.nextQuestion('host-1')

  assert.deepEqual(lastSentTo(sends, 'all'), {
    type: 'game-finished',
    leaderboard: [
      { name: 'Ana', score: 10000, correct: 1, total: 2, timeSpentMs: 0 },
      { name: 'Ben', score: 10000, correct: 1, total: 2, timeSpentMs: 0 },
    ],
  })
})

test('ties are ordered by name and unanswered questions count as wrong', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Zed')
  manager.joinRoom('player-2', code, 'Ava')
  manager.startGame('host-1')
  manager.nextQuestion('host-1')
  manager.nextQuestion('host-1')

  assert.deepEqual(
    lastSentTo(sends, 'all').leaderboard.map((e) => e.name),
    ['Ava', 'Zed'],
  )
  assert.deepEqual(
    lastSentTo(sends, 'all').leaderboard.map((e) => e.score),
    [0, 0],
  )
})

test('nextQuestion rejects non-hosts and calls outside a question', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.startGame('host-1')

  assert.throws(() => manager.nextQuestion('player-1'), /host/i)
  manager.nextQuestion('host-1')
  manager.nextQuestion('host-1')
  assert.throws(() => manager.nextQuestion('host-1'), /question/i)
})

test('closeRoom is host-only, closes the room, and prevents further joins', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')

  assert.throws(() => manager.closeRoom('player-1'), /host/i)
  manager.closeRoom('host-1')

  assert.equal(lastSentTo(sends, 'all').type, 'game-closed')
  assert.throws(() => manager.joinRoom('player-2', code, 'Ben'), /not found/i)
})

test('host disconnect keeps 60s grace for rejoin before ending room', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')

  manager.hostDisconnected('host-1')

  // within grace, room still exists and no host-left yet
  assert.equal(manager.rooms.has(code), true)
  assert.equal(sends.filter((s) => s.message.type === 'host-left').length, 0)
  // rejoin within grace succeeds
  manager.rejoinHost('host-2', code)
  assert.equal(manager.rooms.get(code).hostClientId, 'host-2')
  // after rejoin, new player can still join
  manager.joinRoom('player-2', code, 'Ben')
  assert.equal(manager.rooms.get(code).players.size, 2)

  // grace expiry without rejoin should clean up
  const { manager: m2, sends: s2 } = makeHarness({ now: () => now })
  const { code: code2 } = m2.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  m2.joinRoom('player-1', code2, 'Ana')
  m2.hostDisconnected('host-1')
  now += 61_000
  m2.sweep(now)
  assert.deepEqual(lastSentTo(s2, 'players'), { type: 'host-left' })
  assert.equal(m2.rooms.has(code2), false)
  assert.throws(() => m2.joinRoom('player-2', code2, 'Ben'), /not found/i)
})

test('player disconnect keeps 90s grace and allows same-name reclaim', () => {
  let now = NOW
  const { manager } = makeHarness({ now: () => now })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-2', code, 'Ben')
  const ana = manager.joinRoom('player-1', code, 'Ana').playerId

  manager.playerDisconnected('player-1')

  // within grace, player still in room (not removed), no roster update yet
  assert.equal(manager.rooms.get(code).players.has(ana), true)
  assert.equal(manager.rooms.get(code).players.get(ana).clientId, null)
  // same name can reclaim within grace via rejoin
  manager.rejoin('player-1b', code, ana, 'Ana')
  assert.equal(manager.rooms.get(code).players.get(ana).clientId, 'player-1b')
  // also same-name reclaim via join
  manager.playerDisconnected('player-1b')
  manager.joinRoom('player-3', code, 'Ana')
  assert.equal(manager.rooms.get(code).players.size, 2)
  // original Ana entry reclaimed, still 2 players

  // after grace expiry, player is removed and roster updates
  const { manager: m2b } = makeHarness({ now: () => now })
  const { code: code2 } = m2b.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  m2b.joinRoom('player-1', code2, 'Ana')
  const ben2 = m2b.joinRoom('player-2', code2, 'Ben').playerId
  m2b.playerDisconnected('player-1')
  now += 91_000
  m2b.sweep(now)
  assert.equal(m2b.rooms.get(code2).players.has(ben2), true)
  assert.equal(m2b.rooms.get(code2).players.size, 1)
  assert.throws(() => m2b.rejoin('player-1', code2, ana, 'Ana'), /No pending slot|grace/i)
  // after sweep, startGame works with remaining player
  m2b.startGame('host-1')
  assert.equal(m2b.rooms.get(code2).phase, 'question')
})

test('sweep removes stale rooms but keeps fresh ones', () => {
  const { manager } = makeHarness()
  const stale = manager.createRoom('host-1', {
    topic: 'Old',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  const fresh = manager.createRoom('host-2', {
    topic: 'New',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })

  manager.sweep(NOW + 3 * 60 * 60 * 1000)

  assert.throws(() => manager.joinRoom('player-1', stale.code, 'Ana'), /not found/i)
  assert.throws(() => manager.joinRoom('player-1', fresh.code, 'Ana'), /not found/i)
})

test('createRoom rejects invalid participant caps', () => {
  const { manager } = makeHarness()
  assert.throws(
    () =>
      manager.createRoom('host-1', {
        topic: 'JS',
        timerSeconds: TIMER,
        maxPlayers: 1,
        questions: makeQuestions(2),
      }),
    /participants/i,
  )
  assert.throws(
    () =>
      manager.createRoom('host-2', {
        topic: 'JS',
        timerSeconds: TIMER,
        maxPlayers: 101,
        questions: makeQuestions(2),
      }),
    /participants/i,
  )
  assert.throws(
    () =>
      manager.createRoom('host-3', {
        topic: 'JS',
        timerSeconds: TIMER,
        questions: makeQuestions(2),
      }),
    /participants/i,
  )
})

test('joinRoom rejects players beyond the participant cap', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 2,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  assert.throws(() => manager.joinRoom('player-3', code, 'Cal'), /full/i)
})
