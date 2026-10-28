import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RoomManager } from './roomManager.mjs'

const NOW = 1_000_000
const SOLVE_3 = [
  { from: 0, to: 2 },
  { from: 0, to: 1 },
  { from: 2, to: 1 },
  { from: 0, to: 2 },
  { from: 1, to: 0 },
  { from: 1, to: 2 },
  { from: 0, to: 2 },
]

function makeHarness({ now = () => NOW } = {}) {
  const sends = []
  const manager = new RoomManager({ now, onSend: (event) => sends.push(event) })
  return { manager, sends }
}

function sentTo(sends, to) {
  return sends.filter((s) => s.to === to).map((s) => s.message)
}

function sentType(sends, type) {
  return sends.filter((s) => s.message.type === type).map((s) => s.message)
}

function readyAll(manager, code) {
  const room = manager.rooms.get(code)
  for (const [cid, entry] of manager.playerRooms) {
    if (entry.code === code && room.players.has(entry.playerId)) {
      manager.toggleReady(cid, true)
    }
  }
}

function race(manager, disks = 3) {
  const { code } = manager.createRoom('host-1', { game: 'hanoi', disks, maxPlayers: 8 })
  const ana = manager.joinRoom('player-1', code, 'Ana')
  const ben = manager.joinRoom('player-2', code, 'Ben')
  readyAll(manager, code)
  return { code, ana, ben }
}

test('createRoom builds a race room and voices it to the host', () => {
  const { manager, sends } = makeHarness()
  const { code } = manager.createRoom('host-1', { game: 'hanoi', disks: 4, maxPlayers: 8 })
  const room = manager.rooms.get(code)
  assert.equal(room.game, 'hanoi')
  assert.equal(room.gameState.disks, 4)
  assert.equal(room.quizReady, true)
  assert.equal(room.hostStatus, 'waiting-to-start')

  const created = sentTo(sends, 'host')[0]
  assert.equal(created.type, 'room-created')
  assert.equal(created.game, 'hanoi')
  assert.equal(created.disks, 4)
})

test('createRoom rejects invalid disk counts and caps', () => {
  const { manager } = makeHarness()
  assert.throws(() => manager.createRoom('h1', { game: 'hanoi', disks: 2, maxPlayers: 8 }), /Disks/)
  assert.throws(() => manager.createRoom('h2', { game: 'hanoi', disks: 9, maxPlayers: 8 }), /Disks/)
  assert.throws(
    () => manager.createRoom('h3', { game: 'hanoi', disks: 4, maxPlayers: 1 }),
    /participants/i,
  )
})

test('a race needs two ready players before the countdown', () => {
  const { manager } = makeHarness()
  const { code } = manager.createRoom('host-1', { game: 'hanoi', disks: 3, maxPlayers: 8 })
  manager.joinRoom('player-1', code, 'Ana')
  readyAll(manager, code)
  assert.throws(() => manager.startGame('host-1'), /2 players/i)

  manager.joinRoom('player-2', code, 'Ben')
  manager.toggleReady('player-2', true)
  manager.startGame('host-1')
  assert.equal(manager.rooms.get(code).phase, 'starting')
})

test('the countdown starts the race with a shared server start time', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  const { code } = race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  const room = manager.rooms.get(code)
  assert.equal(room.phase, 'racing')
  assert.equal(room.gameState.startedAt, now)
  const started = sentType(sends, 'hanoi-started').at(-1)
  assert.equal(started.disks, 3)
  assert.equal(started.startedAt, now)
})

test('finishes are ranked by server finish time regardless of claimed order', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  // Ana finishes first, then Ben a second later
  now += 1000
  manager.finishHanoi('player-1', { moves: SOLVE_3, hintsUsed: 1 })
  now += 1000
  manager.finishHanoi('player-2', { moves: SOLVE_3, hintsUsed: 0 })

  const standings = sentType(sends, 'hanoi-standings').at(-1)
  assert.ok(standings)

  const finished = sentType(sends, 'hanoi-finished').at(-1)
  assert.deepEqual(
    finished.standings.map((e) => [e.playerId, e.rank]),
    [
      ['p-1', 1],
      ['p-2', 2],
    ],
  )
  assert.equal(finished.standings[0].elapsedMs, 1000)
  assert.equal(finished.standings[1].elapsedMs, 2000)
})

test('a submitted solve is rejected unless the move log really solves the puzzle', () => {
  let now = NOW
  const { manager } = makeHarness({ now: () => now })
  race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  assert.throws(
    () =>
      manager.finishHanoi('player-1', {
        moves: [
          { from: 0, to: 1 },
          { from: 0, to: 1 },
        ],
        hintsUsed: 0,
      }),
    /Illegal move/,
  )
  assert.throws(
    () => manager.finishHanoi('player-1', { moves: [{ from: 0, to: 2 }], hintsUsed: 0 }),
    /not solved/,
  )
  assert.throws(() => manager.finishHanoi('player-1', { moves: SOLVE_3, hintsUsed: 99 }), /hint/i)
})

test('resigning ranks a player after the finishers; the host can end the race', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  now += 1000
  manager.finishHanoi('player-1', { moves: SOLVE_3, hintsUsed: 0 })
  manager.resignHanoi('player-2')

  const finished = sentType(sends, 'hanoi-finished').at(-1)
  assert.deepEqual(
    finished.standings.map((e) => [e.playerId, e.status, e.rank]),
    [
      ['p-1', 'finished', 1],
      ['p-2', 'dnf', 2],
    ],
  )
})

test('the host can end a race early, marking every unfinished seat a DNF', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  manager.endHanoiRace('host-1')
  const finished = sentType(sends, 'hanoi-finished').at(-1)
  assert.equal(
    finished.standings.every((e) => e.status === 'dnf'),
    true,
  )
  assert.throws(() => manager.resignHanoi('player-1'), /not started/i)
})

test('an intentional exit mid-race records a DNF', () => {
  let now = NOW
  const { manager } = makeHarness({ now: () => now })
  race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  const out = manager.clientExit('player-1')
  assert.equal(out.removed, true)
  const room = manager.rooms.get(manager.hostRooms.get('host-1'))
  assert.equal(room.gameState.results.get('p-1').status, 'dnf')
  // Ben is still racing, so the race is not over
  assert.equal(room.phase, 'racing')
  now += 1000
  manager.finishHanoi('player-2', { moves: SOLVE_3, hintsUsed: 0 })
  assert.equal(room.phase, 'finished')
})

test('a rejoining racer hydrates the hanoi snapshot from state-sync', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  const { code, ana } = race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)
  now += 1000
  manager.finishHanoi('player-1', { moves: SOLVE_3, hintsUsed: 0 })

  manager.playerDisconnected('player-1')
  const before = sends.length
  manager.rejoin('player-9', code, ana.playerId, 'Ana', ana.resumeSecret)
  const sync = sends
    .slice(before)
    .map((s) => s.message)
    .find((m) => m.type === 'state-sync')

  assert.equal(sync.game, 'hanoi')
  assert.equal(sync.phase, 'racing')
  assert.equal(sync.hanoi.disks, 3)
  assert.equal(sync.hanoi.startedAt, NOW + 5000)
  assert.equal(sync.hanoi.myResult.status, 'finished')
})

test('the creator also takes a player seat and races', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  const { code } = manager.createRoom('host-1', { game: 'hanoi', disks: 3, maxPlayers: 4 })
  // the creator's own socket joins the room it made
  const creator = manager.joinRoom('host-1', code, 'Hosty')
  assert.equal(typeof creator.playerId, 'string')
  const ben = manager.joinRoom('player-2', code, 'Ben')

  manager.toggleReady('host-1', true)
  manager.toggleReady('player-2', true)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)

  now += 1000
  manager.finishHanoi('host-1', { moves: SOLVE_3, hintsUsed: 0 })
  now += 1000
  manager.finishHanoi('player-2', { moves: SOLVE_3, hintsUsed: 0 })

  const finished = sentType(sends, 'hanoi-finished').at(-1)
  assert.deepEqual(
    finished.standings.map((e) => [e.name, e.rank]),
    [
      ['Hosty', 1],
      ['Ben', 2],
    ],
  )
  assert.equal(ben.playerId !== creator.playerId, true)
})

test('backToLobby resets a finished race and keeps the roster', () => {
  let now = NOW
  const { manager, sends } = makeHarness({ now: () => now })
  const { code, ana } = race(manager)
  manager.startGame('host-1')
  now += 5000
  manager.processAdvances(now)
  now += 1000
  manager.finishHanoi('player-1', { moves: SOLVE_3, hintsUsed: 0 })
  manager.finishHanoi('player-2', { moves: SOLVE_3, hintsUsed: 0 })

  manager.backToLobby('host-1')
  const room = manager.rooms.get(code)
  assert.equal(room.phase, 'lobby')
  assert.equal(room.gameState.results.size, 0)
  assert.equal(room.gameState.startedAt, 0)
  assert.equal(room.players.has(ana.playerId), true)
  assert.equal(room.players.get(ana.playerId).ready, false)
  const toLobby = sentType(sends, 'room-to-lobby').at(-1)
  assert.equal(toLobby.game, 'hanoi')
  assert.equal(toLobby.disks, 3)
})
