import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HANOI_MAX_MOVES, rankHanoi, validateSolve } from './hanoiRace.mjs'

// The classic 3-disk solution, seven moves, peg 0 -> peg 2.
const SOLVE_3 = [
  { from: 0, to: 2 },
  { from: 0, to: 1 },
  { from: 2, to: 1 },
  { from: 0, to: 2 },
  { from: 1, to: 0 },
  { from: 1, to: 2 },
  { from: 0, to: 2 },
]

test('validateSolve accepts a legal, solved move log', () => {
  const result = validateSolve({ disks: 3, moves: SOLVE_3, hintsUsed: 1 })
  assert.deepEqual(result, { moves: 7, hintsUsed: 1 })
})

test('validateSolve rejects an illegal move', () => {
  // 0->1 first is legal only for the top disk; 0->1 then 0->1 again is illegal
  // because peg 1 then holds a smaller disk than the one being moved.
  assert.throws(
    () =>
      validateSolve({
        disks: 3,
        moves: [
          { from: 0, to: 1 },
          { from: 0, to: 1 },
        ],
        hintsUsed: 0,
      }),
    /Illegal move/,
  )
})

test('validateSolve rejects a log that does not solve the puzzle', () => {
  assert.throws(
    () => validateSolve({ disks: 3, moves: [{ from: 0, to: 2 }], hintsUsed: 0 }),
    /not solved/,
  )
})

test('validateSolve rejects malformed logs and bad hint counts', () => {
  assert.throws(() => validateSolve({ disks: 3, moves: [], hintsUsed: 0 }), /move log/)
  assert.throws(
    () =>
      validateSolve({
        disks: 3,
        moves: Array.from({ length: HANOI_MAX_MOVES + 1 }, () => ({ from: 0, to: 1 })),
        hintsUsed: 0,
      }),
    /move log/,
  )
  assert.throws(
    () => validateSolve({ disks: 3, moves: [{ from: 0, to: 9 }], hintsUsed: 0 }),
    /move log/,
  )
  assert.throws(() => validateSolve({ disks: 3, moves: SOLVE_3, hintsUsed: -1 }), /hint/i)
  // 3 disks allow 3 hints
  assert.throws(() => validateSolve({ disks: 3, moves: SOLVE_3, hintsUsed: 4 }), /hint/i)
  assert.throws(() => validateSolve({ disks: 99, moves: SOLVE_3, hintsUsed: 0 }), /Disks/)
})

test('rankHanoi orders finishers by time, then moves, then hints, then name', () => {
  const standings = rankHanoi(
    [
      {
        playerId: 'p-1',
        name: 'Ana',
        status: 'finished',
        finishedAt: 5000,
        moves: 7,
        hintsUsed: 0,
      },
      {
        playerId: 'p-2',
        name: 'Ben',
        status: 'finished',
        finishedAt: 4000,
        moves: 9,
        hintsUsed: 0,
      },
      {
        playerId: 'p-3',
        name: 'Cal',
        status: 'finished',
        finishedAt: 4000,
        moves: 7,
        hintsUsed: 2,
      },
      {
        playerId: 'p-4',
        name: 'Dee',
        status: 'finished',
        finishedAt: 4000,
        moves: 7,
        hintsUsed: 0,
      },
      { playerId: 'p-5', name: 'Eve', status: 'pending', finishedAt: 0, moves: 0, hintsUsed: 0 },
      { playerId: 'p-6', name: 'Fay', status: 'dnf', finishedAt: 4500, moves: 0, hintsUsed: 0 },
    ],
    1000,
  )

  assert.deepEqual(
    standings.map((entry) => entry.playerId),
    ['p-4', 'p-3', 'p-2', 'p-1', 'p-5', 'p-6'],
  )
  assert.deepEqual(
    standings.slice(0, 3).map((entry) => entry.rank),
    [1, 2, 3],
  )
  // elapsed measured from the race start
  assert.equal(standings[0].elapsedMs, 3000)
  assert.equal(standings.find((e) => e.playerId === 'p-5').elapsedMs, 0)
})
