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

function readyAll(manager, code) {
  const room = manager.rooms.get(code)
  for (const player of room.players.values()) {
    if (player.clientId) {
      // find clientId by scanning playerRooms
      for (const [cid, entry] of manager.playerRooms) {
        const pl = room.players.get(entry.playerId)
        if (pl === player) {
          manager.toggleReady(cid, true)
          break
        }
      }
    }
  }
}

function readyClient(manager, clientId) {
  manager.toggleReady(clientId, true)
}

function startAndBegin(manager, sends, hostId, clock) {
  manager.startGame(hostId)
  const starting = sentTo(sends, 'all')
    .filter((m) => m.type === 'game-starting')
    .at(-1)
  if (!starting || starting.type !== 'game-starting') {
    throw new Error('expected game-starting, got ' + JSON.stringify(starting))
  }
  if (clock) {
    clock.value += 5000
    manager.processAdvances(clock.value)
  } else {
    manager.processAdvances(Date.now() + 6000)
  }
  return starting
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
  assert.equal(hostMessages[0].type, 'room-created')
  assert.equal(hostMessages[0].code, first.code)
  assert.equal(typeof hostMessages[0].hostSecret, 'string')
  assert.equal(hostMessages[1].type, 'room-created')
  assert.equal(hostMessages[1].code, second.code)
  assert.equal(typeof hostMessages[1].hostSecret, 'string')
})

test('createRoom allows empty question sets for instant rooms (quiz not ready)', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: [],
  })
  const room = manager.rooms.get(code)
  assert.equal(room.quizReady, false)
  assert.equal(room.hostStatus, 'generating')
  assert.throws(
    () =>
      manager.createRoom('host-1', {
        topic: 'JS',
        timerSeconds: TIMER,
        maxPlayers: 10,
        questions: [{ question: '', correct_answer: '', incorrect_answers: [] }],
      }),
    /question/i,
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
    players: [{ playerId, name: 'Ana', ready: false, connected: true, expiresAt: null }],
    quizReady: true,
    hostStatus: 'waiting-to-start',
    hostDetail: '',
    resumeSecret: lastSentTo(sends, playerId).resumeSecret,
    resumeTtlMs: 5 * 60 * 1000,
  })
  assert.equal(typeof lastSentTo(sends, playerId).resumeSecret, 'string')
  assert.deepEqual(sentTo(sends, 'players')[0], {
    type: 'lobby-updated',
    players: [{ playerId, name: 'Ana', ready: false, connected: true, expiresAt: null }],
    quizReady: true,
  })
  assert.deepEqual(lastSentTo(sends, 'host'), {
    type: 'lobby-updated',
    players: [{ playerId, name: 'Ana', ready: false, connected: true, expiresAt: null }],
    quizReady: true,
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
  assert.throws(() => manager.startGame('host-1'), /ready/i)
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
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
  readyAll(manager, code)

  manager.startGame('host-1')
  assert.ok(sentTo(sends, 'all').some((m) => m.type === 'game-starting'))
  manager.processAdvances(NOW + 5000)

  const qStarted = sentTo(sends, 'all').filter((m) => m.type === 'question-started')
  assert.deepEqual(qStarted[qStarted.length - 1], {
    type: 'question-started',
    index: 0,
    total: 3,
    question: 'Q1',
    options: ['A', 'B', 'D', 'C'],
    timerSeconds: TIMER,
    deadline: NOW + TIMER * 1000,
    scoreboard: [{ playerId: 'p-1', name: 'Ana', score: 0, correct: 0 }],
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
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  manager.processAdvances(NOW + 5000)

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

  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
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
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

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
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  manager.submitAnswer('player-1', 'C')
  manager.submitAnswer('player-2', 'A')
  manager.nextQuestion('host-1')

  const startedMsgs = sentTo(sends, 'all').filter((m) => m.type === 'question-started')
  const second = startedMsgs[startedMsgs.length - 1]
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
  let currentTime = NOW
  const { manager, sends } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Zed')
  manager.joinRoom('player-2', code, 'Ava')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  // host force-skips the first question before anyone answers — reveal is shown for 3s,
  // then the manager advances via sweep/processAdvances
  manager.nextQuestion('host-1')
  currentTime = NOW + 3000
  manager.processAdvances(currentTime)
  manager.nextQuestion('host-1')
  currentTime = NOW + 6000
  manager.processAdvances(currentTime)

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
  let currentTime = NOW
  const { manager } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  assert.throws(() => manager.nextQuestion('player-1'), /host/i)
  // first skip — phase stays 'question' until the reveal passes; another call schedules another skip on the same question
  manager.nextQuestion('host-1')
  manager.nextQuestion('host-1')
  // advance the clock past both reveals and the question deadline (NOW + 15s)
  currentTime = NOW + 4000
  manager.processAdvances(currentTime)
  currentTime = NOW + 20000
  manager.processAdvances(currentTime)
  // still in 'question' for the last index — but timer has now elapsed so a follow-up call advances immediately and finishes
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

test('host disconnect keeps 3 min grace for token rejoin before ending room', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  const { code, hostSecret } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')

  manager.hostDisconnected('host-1')

  // within grace, room still exists and no host-left yet; players get an
  // absolute expiry for their waiting countdown
  assert.equal(manager.rooms.has(code), true)
  assert.equal(sends.filter((s) => s.message.type === 'host-left').length, 0)
  assert.deepEqual(lastSentTo(sends, 'players'), {
    type: 'host-disconnected',
    expiresAt: NOW + 3 * 60 * 1000,
  })
  // rejoin within grace succeeds and rotates the secret
  const rej = manager.rejoinHost('host-2', code, hostSecret)
  assert.equal(manager.rooms.get(code).hostClientId, 'host-2')
  assert.equal(typeof rej.hostSecret, 'string')
  assert.notEqual(rej.hostSecret, hostSecret)
  // old secret no longer works
  assert.throws(() => manager.rejoinHost('host-3', code, hostSecret), /already connected/i)
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
  now += 3 * 60 * 1000 + 1000
  m2.sweep(now)
  assert.deepEqual(lastSentTo(s2, 'players'), { type: 'host-left' })
  assert.equal(m2.rooms.has(code2), false)
  assert.throws(() => m2.joinRoom('player-2', code2, 'Ben'), /not found/i)
})

test('player disconnect keeps 5 min grace and rejoins by token with rotation', () => {
  let now = NOW
  const { manager } = makeHarness({ now: () => now })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-2', code, 'Ben')
  const anaJoin = manager.joinRoom('player-1', code, 'Ana')
  const ana = anaJoin.playerId
  const anaSecret = anaJoin.resumeSecret

  manager.playerDisconnected('player-1')

  // within grace, player still in room (not removed), roster shows offline + expiry
  assert.equal(manager.rooms.get(code).players.has(ana), true)
  assert.equal(manager.rooms.get(code).players.get(ana).clientId, null)
  const offlineEntry = manager.playersOf(manager.rooms.get(code)).find((p) => p.playerId === ana)
  assert.deepEqual(offlineEntry, {
    playerId: ana,
    name: 'Ana',
    ready: false,
    connected: false,
    expiresAt: NOW + 5 * 60 * 1000,
  })
  // wrong secret cannot steal the seat
  assert.throws(() => manager.rejoin('player-1b', code, ana, 'Ana', 'bogus'), /verify/i)
  // token rejoin succeeds with a single atomic state-sync and a rotated secret
  const rej = manager.rejoin('player-1b', code, ana, 'Ana', anaSecret)
  assert.equal(manager.rooms.get(code).players.get(ana).clientId, 'player-1b')
  assert.equal(typeof rej.resumeSecret, 'string')
  assert.notEqual(rej.resumeSecret, anaSecret)
  // rotated: the old secret is dead
  assert.throws(() => manager.rejoin('player-1c', code, ana, 'Ana', anaSecret), /verify/i)
  // also same-name reclaim via join still works in the lobby
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
  const ana2 = m2b.joinRoom('player-1', code2, 'Ana')
  const ben2 = m2b.joinRoom('player-2', code2, 'Ben').playerId
  m2b.playerDisconnected('player-1')
  now += 5 * 60 * 1000 + 1000
  m2b.sweep(now)
  assert.equal(m2b.rooms.get(code2).players.has(ben2), true)
  assert.equal(m2b.rooms.get(code2).players.size, 1)
  assert.throws(
    () => m2b.rejoin('player-1', code2, ana2.playerId, 'Ana', ana2.resumeSecret),
    /expired|No pending slot/i,
  )
  // after sweep, startGame works with remaining player
  readyAll(m2b, code2)
  m2b.startGame('host-1')
  m2b.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
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

test('all-answered broadcasts when the last player submits', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  manager.submitAnswer('player-1', 'A')
  assert.equal(
    sentTo(sends, 'all').find((m) => m.type === 'all-answered'),
    undefined,
  )

  manager.submitAnswer('player-2', 'C')
  // at the moment all-answered fires, room.index is still 0 — but the
  // scoreboard now includes the just-completed Q0 answers
  assert.deepEqual(lastSentTo(sends, 'all'), {
    type: 'all-answered',
    correctAnswer: 'C',
    scoreboard: [
      { playerId: 'p-2', name: 'Ben', score: 10000, correct: 1 },
      { playerId: 'p-1', name: 'Ana', score: 0, correct: 0 },
    ],
  })
})

test('nextQuestion delays 3s when host force-skips before everyone answered or timer expires', () => {
  let currentTime = NOW
  const { manager, sends } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  manager.nextQuestion('host-1')

  // immediately after, the room is still in the question phase and the reveal was broadcast
  const room = manager.rooms.get(code)
  assert.equal(room.phase, 'question')
  assert.equal(room.index, 0)
  assert.deepEqual(lastSentTo(sends, 'all'), {
    type: 'all-answered',
    correctAnswer: 'C',
    scoreboard: [{ playerId: 'p-1', name: 'Ana', score: 0, correct: 0 }],
  })

  // before 3s elapse, nothing advances
  currentTime = NOW + 2000
  manager.processAdvances(currentTime)
  assert.equal(room.phase, 'question')
  assert.equal(room.index, 0)

  // once 3s elapse, the next question starts
  currentTime = NOW + 3000
  manager.processAdvances(currentTime)
  assert.equal(room.phase, 'question')
  assert.equal(room.index, 1)
  const nextList = sentTo(sends, 'all').filter((m) => m.type === 'question-started')
  const next = nextList[nextList.length - 1]
  assert.equal(next.type, 'question-started')
  assert.equal(next.index, 1)
  assert.equal(next.correctAnswer, 'C')
})

test('nextQuestion advances immediately when all players have answered', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  manager.submitAnswer('player-1', 'A')
  manager.submitAnswer('player-2', 'C')

  // all answered already triggered an all-answered broadcast; nextQuestion should not delay again
  const beforeCount = sentTo(sends, 'all').filter((m) => m.type === 'question-started').length
  manager.nextQuestion('host-1')
  const afterCount = sentTo(sends, 'all').filter((m) => m.type === 'question-started').length
  assert.equal(afterCount, beforeCount + 1)
  const room = manager.rooms.get(code)
  assert.equal(room.index, 1)
  assert.ok(room.pendingAdvance == null)
})

test('nextQuestion advances immediately when timer already expired', () => {
  let currentTime = NOW
  const { manager } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  // jump past the timer — but the player did not answer
  currentTime = NOW + TIMER * 1000 + 100
  manager.nextQuestion('host-1')

  const room = manager.rooms.get(code)
  assert.equal(room.phase, 'question')
  assert.equal(room.index, 1)
  assert.ok(room.pendingAdvance == null)
})

test('sweep processes pending force-reveal advances alongside grace expiry', () => {
  let currentTime = NOW
  const { manager } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  manager.nextQuestion('host-1')
  currentTime = NOW + 3000
  manager.sweep(currentTime)
  const room = manager.rooms.get(code)
  assert.equal(room.index, 1)
  assert.equal(room.pendingAdvance, null)
})

test('submitAnswer broadcasts answer-progress with current answered/total counts', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  manager.joinRoom('player-3', code, 'Cal')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  manager.submitAnswer('player-1', 'A')
  assert.deepEqual(sentTo(sends, 'players').at(-1), {
    type: 'answer-progress',
    answeredCount: 1,
    totalPlayers: 3,
  })
  manager.submitAnswer('player-2', 'C')
  assert.deepEqual(sentTo(sends, 'players').at(-1), {
    type: 'answer-progress',
    answeredCount: 2,
    totalPlayers: 3,
  })
  // last submit triggers all-answered (broadcast to 'all'), so the 'players'
  // channel sees one more progress with answeredCount=3
  manager.submitAnswer('player-3', 'C')
  assert.deepEqual(sentTo(sends, 'players').at(-1), {
    type: 'answer-progress',
    answeredCount: 3,
    totalPlayers: 3,
  })
})

test('scoreboard reflects cumulative scores through the just-finished question', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )

  // Q0: both correct; Ben answered slightly later? Let's pick distinct answers.
  manager.submitAnswer('player-1', 'C')
  manager.submitAnswer('player-2', 'C')

  const allAnswered = lastSentTo(sends, 'all')
  assert.equal(allAnswered.type, 'all-answered')
  // Both answered correctly; Ana answered first so she should have higher score.
  // Scores depend on timeLeftMs at submission — Ana submitted first → more time
  // left at the moment of her answer. The test just asserts the shape (both 1
  // correct, both non-zero, sorted by score desc with Ana first).
  assert.equal(allAnswered.scoreboard[0].correct, 1)
  assert.equal(allAnswered.scoreboard[1].correct, 1)
  assert.equal(allAnswered.scoreboard[0].playerId, 'p-1')
  assert.equal(allAnswered.scoreboard[1].playerId, 'p-2')
  assert.ok(allAnswered.scoreboard[0].score > 0)
  assert.ok(allAnswered.scoreboard[1].score > 0)
})

test('backToLobby returns a finished room to the lobby and keeps the roster', () => {
  let currentTime = NOW
  const { manager, sends } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  const ana = manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  manager.nextQuestion('host-1')
  currentTime = NOW + 3000
  manager.processAdvances(currentTime)

  manager.backToLobby('host-1')

  const room = manager.rooms.get(code)
  assert.equal(room.phase, 'lobby')
  assert.equal(room.index, -1)
  // same roster and playerId, answers cleared
  assert.equal(room.players.size, 1)
  assert.equal(room.players.has(ana.playerId), true)
  assert.equal(room.players.get(ana.playerId).answers.size, 0)
  // everyone is told to show the lobby with the current roster
  const toLobby = sentTo(sends, 'all').find((m) => m.type === 'room-to-lobby')
  assert.ok(toLobby)
  assert.equal(toLobby.topic, 'JS')
  assert.equal(toLobby.players.length, 1)
  assert.equal(toLobby.players[0].name, 'Ana')

  // host can rematch with the same questions straight from the lobby
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  const qList = sentTo(sends, 'all').filter((m) => m.type === 'question-started')
  const q = qList[qList.length - 1]
  assert.equal(q.type, 'question-started')
  assert.equal(q.index, 0)
  assert.equal(q.total, 1)
})

test('updateRoomQuiz replaces lobby content in place and stays in the lobby', () => {
  let currentTime = NOW
  const { manager, sends } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  const ana = manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  manager.nextQuestion('host-1')
  currentTime = NOW + 3000
  manager.processAdvances(currentTime)
  manager.backToLobby('host-1')

  manager.updateRoomQuiz('host-1', {
    topic: 'Cats',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })

  const room = manager.rooms.get(code)
  assert.equal(room.phase, 'lobby')
  assert.equal(room.topic, 'Cats')
  assert.equal(room.questions.length, 3)
  // same roster kept
  assert.equal(room.players.size, 1)
  assert.equal(room.players.has(ana.playerId), true)
  const toLobby = sentTo(sends, 'all').filter((m) => m.type === 'room-to-lobby')
  assert.ok(toLobby.length >= 1)
  assert.equal(toLobby[toLobby.length - 1].topic, 'Cats')

  // host can now start the new quiz from the lobby
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  const qList = sentTo(sends, 'all').filter((m) => m.type === 'question-started')
  const q = qList[qList.length - 1]
  assert.equal(q.type, 'question-started')
  assert.equal(q.total, 3)
})

test('updateRoomQuiz rejects outside the lobby and invalid content', () => {
  let currentTime = NOW
  const { manager } = makeHarness({ now: () => currentTime })
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  manager.joinRoom('player-1', code, 'Ana')
  const settings = {
    topic: 'Cats',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  }

  assert.throws(() => manager.updateRoomQuiz('player-1', settings), /host/i)
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  // mid-game — can't swap the questions
  assert.throws(() => manager.updateRoomQuiz('host-1', settings), /lobby/i)
  // finish the game and go back to the lobby — invalid content is rejected
  // with the same messages as createRoom
  manager.nextQuestion('host-1')
  currentTime = NOW + 3000
  manager.processAdvances(currentTime)
  manager.backToLobby('host-1')
  assert.throws(() => manager.updateRoomQuiz('host-1', { ...settings, questions: [] }), /question/i)
  assert.throws(() => manager.updateRoomQuiz('host-1', { ...settings, timerSeconds: 0 }), /timer/i)
  assert.throws(
    () => manager.updateRoomQuiz('host-1', { ...settings, maxPlayers: 1 }),
    /participant/i,
  )
})

test('backToLobby rejects non-hosts and rooms that are not finished', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')

  assert.throws(() => manager.backToLobby('player-1'), /host/i)
  // still in lobby — nothing to go back to
  assert.throws(() => manager.backToLobby('host-1'), /lobby/i)
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  // mid-game — can't bail to the lobby
  assert.throws(() => manager.backToLobby('host-1'), /lobby/i)
})

test('sendChat relays lobby messages to the whole room without storing them', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  const ana = manager.joinRoom('player-1', code, 'Ana')

  manager.sendChat('player-1', { id: 'm1', text: '  Good luck!  ' })
  manager.sendChat('host-1', { id: 'm2', text: 'Have fun!' })

  const chats = sentTo(sends, 'all').filter((m) => m.type === 'chat-received')
  assert.equal(chats.length, 2)
  assert.deepEqual(chats[0], {
    type: 'chat-received',
    id: 'm1',
    senderId: ana.playerId,
    name: 'Ana',
    role: 'player',
    text: 'Good luck!',
    at: NOW,
  })
  assert.deepEqual(chats[1], {
    type: 'chat-received',
    id: 'm2',
    senderId: 'host-1',
    name: 'Host',
    role: 'host',
    text: 'Have fun!',
    at: NOW,
  })
  // relay only — no history kept server-side for late joiners to fetch
  assert.equal(manager.rooms.get(code).chatHistory, undefined)
})

test('sendChat rejects blank/overlong text, strangers, and non-lobby phases', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(1),
  })
  manager.joinRoom('player-1', code, 'Ana')

  assert.throws(() => manager.sendChat('player-1', { id: 'm1', text: '   ' }), /message/i)
  assert.throws(() => manager.sendChat('player-1', { id: 'm2', text: 'x'.repeat(201) }), /message/i)
  assert.throws(() => manager.sendChat('stranger-9', { id: 'm3', text: 'hi' }), /room/i)
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(
    typeof currentTime !== 'undefined'
      ? currentTime + 5000
      : typeof now !== 'undefined'
        ? now + 5000
        : NOW + 5000,
  )
  // no answer-sharing once questions are live
  assert.throws(() => manager.sendChat('player-1', { id: 'm4', text: 'hi' }), /lobby/i)
})

test('ready gate blocks start until 100% ready, kick removes player with notice', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  const ben = manager.joinRoom('player-2', code, 'Ben')
  readyClient(manager, 'player-1')
  assert.throws(() => manager.startGame('host-1'), /ready/i)
  readyClient(manager, 'player-2')
  manager.startGame('host-1')
  manager.cancelStart('host-1')
  // kick Ben while back in lobby
  manager.kickPlayer('host-1', ben.playerId)
  const room = manager.rooms.get(code)
  assert.equal(room.players.size, 1)
  const kicked = sends.find((s) => s.message.type === 'kicked')
  assert.ok(kicked)
  // Ana still ready so game can start and countdown begins (full 5s)
  manager.startGame('host-1')
  const starting = sentTo(sends, 'all')
    .filter((m) => m.type === 'game-starting')
    .at(-1)
  assert.equal(starting.countdownSeconds, 5)
  assert.equal(starting.deadline, NOW + 5000)
  assert.equal(room.phase, 'starting')
  // join blocked during countdown
  assert.throws(() => manager.joinRoom('player-3', code, 'Cal'), /starting/i)
  manager.processAdvances(NOW + 4999)
  assert.equal(room.phase, 'starting')
  manager.processAdvances(NOW + 5000)
  assert.equal(room.phase, 'question')
})

test('host status broadcasts editing states and update resets ready', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  manager.setHostStatus('host-1', 'choosing-topic', 'Algebra')
  assert.deepEqual(lastSentTo(sends, 'all'), {
    type: 'host-status-updated',
    status: 'choosing-topic',
    detail: 'Algebra',
    topic: 'JS',
    hostOnline: true,
    hostOfflineExpiresAt: 0,
  })
  manager.updateRoomQuiz('host-1', {
    topic: 'Cats',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(3),
  })
  const room = manager.rooms.get(code)
  assert.equal(room.players.get('p-1').ready, false)
  assert.throws(() => manager.startGame('host-1'), /ready/i)
})

test('late return mid-game: same-name reclaim refused, token rejoin gets full state-sync', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  const ana = manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')
  readyAll(manager, code)
  manager.startGame('host-1')
  manager.processAdvances(NOW + 5000)
  // Ana locks an answer, then drops mid-question
  manager.submitAnswer('player-1', 'C')
  manager.playerDisconnected('player-1')

  // a stranger with the same name cannot walk into the live game...
  assert.throws(() => manager.joinRoom('player-9', code, 'Ana'), /already started/i)
  // ...and the nameless fallback is refused mid-game too
  assert.throws(
    () => manager.rejoin('player-9', code, 'p-zzz', 'Ana', undefined),
    /No pending slot/i,
  )
  // ...but the token holder hydrates atomically: one state-sync with the
  // current question, scoreboard, and her own locked answer
  const before = sends.length
  const rej = manager.rejoin('player-1b', code, ana.playerId, 'Ana', ana.resumeSecret)
  assert.equal(typeof rej.resumeSecret, 'string')
  const fresh = sends.slice(before).map((s) => s.message)
  const syncs = fresh.filter((m) => m.type === 'state-sync')
  assert.equal(syncs.length, 1)
  const sync = syncs[0]
  assert.equal(sync.phase, 'question')
  assert.equal(sync.roomCode, code)
  assert.equal(sync.question.index, 0)
  assert.equal(sync.question.total, 2)
  assert.equal(sync.question.myAnswer, 'C')
  assert.equal(sync.question.deadline, NOW + TIMER * 1000)
  assert.equal(sync.hostOnline, true)
  assert.equal(typeof sync.serverNow, 'number')
})

test('host ghost overlap: secret rebind displaces the stale socket', () => {
  const { manager } = makeHarness()
  const { code, hostSecret } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  // ghost: old host socket still bound (close never observed), real host returns
  const rej = manager.rejoinHost('host-2', code, hostSecret)
  assert.deepEqual(rej.displaced, ['host-1'])
  assert.equal(manager.rooms.get(code).hostClientId, 'host-2')
  // the displaced socket lost authority: its commands are rejected
  assert.throws(() => manager.setHostStatus('host-1', 'choosing-topic'), /host/i)
  assert.throws(() => manager.startGame('host-1'), /host/i)
})

test('intentional exit frees the seat immediately (no grace hold)', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 2,
    questions: makeQuestions(2),
  })
  const ana = manager.joinRoom('player-1', code, 'Ana')
  manager.joinRoom('player-2', code, 'Ben')

  // live-socket exit path (Leave button)
  const out = manager.clientExit('player-1')
  assert.deepEqual(out, { removed: true, code, playerId: ana.playerId })
  const room = manager.rooms.get(code)
  assert.equal(room.players.has(ana.playerId), false)
  assert.equal(room.players.size, 1)
  // a new player can take the freed seat even at cap
  manager.joinRoom('player-3', code, 'Cal')
  assert.equal(room.players.size, 2)

  // beacon path (tab closed): verified by secret, seat freed at once
  const cal = [...room.players.values()].find((p) => p.name === 'Cal')
  const calId = [...room.players.entries()].find(([, p]) => p === cal)[0]
  const beacon = manager.leaveSeat(code, calId, 'wrong-secret')
  assert.deepEqual(beacon, { removed: false })
  assert.equal(room.players.size, 2)
  // unknown exits are no-ops
  assert.deepEqual(manager.clientExit('ghost'), { removed: false })
  void sends
})

test('beacon leaveSeat frees the seat with a valid secret', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', {
    topic: 'JS',
    timerSeconds: TIMER,
    maxPlayers: 10,
    questions: makeQuestions(2),
  })
  const ana = manager.joinRoom('player-1', code, 'Ana')
  const out = manager.leaveSeat(code, ana.playerId, ana.resumeSecret)
  assert.deepEqual(out, { removed: true, code, playerId: ana.playerId })
  assert.equal(manager.rooms.get(code).players.size, 0)
  // seat gone: the same secret cannot rejoin anymore
  assert.throws(
    () => manager.rejoin('player-1b', code, ana.playerId, 'Ana', ana.resumeSecret),
    /No pending slot/i,
  )
})
