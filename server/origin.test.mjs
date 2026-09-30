import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOriginAllowed, parseAllowedOrigins } from './origin.mjs'

const NONE = new Set()

test('origin check: a request without an Origin is allowed (non-browser client)', () => {
  assert.equal(isOriginAllowed(undefined, 'room.example.com', NONE), true)
  assert.equal(isOriginAllowed('', 'room.example.com', NONE), true)
})

test('origin check: same host is allowed regardless of port (local dev)', () => {
  assert.equal(isOriginAllowed('http://localhost:5173', 'localhost:8787', NONE), true)
  assert.equal(isOriginAllowed('https://app.example.com', 'app.example.com', NONE), true)
})

test('origin check: cross-origin without an allowlist entry is denied', () => {
  // the split-deploy regression: SPA on Vercel, room server on Render
  assert.equal(
    isOriginAllowed('https://quiznix.vercel.app', 'quiznix-ai.onrender.com', NONE),
    false,
  )
})

test('origin check: an allowlisted full origin is allowed cross-origin', () => {
  const allowed = parseAllowedOrigins('https://quiznix.vercel.app')
  assert.equal(
    isOriginAllowed('https://quiznix.vercel.app', 'quiznix-ai.onrender.com', allowed),
    true,
  )
})

test('origin check: an allowlisted bare hostname is allowed cross-origin', () => {
  const allowed = parseAllowedOrigins('quiznix.vercel.app')
  assert.equal(
    isOriginAllowed('https://quiznix.vercel.app', 'quiznix-ai.onrender.com', allowed),
    true,
  )
})

test('origin check: a lookalike host is not allowed', () => {
  const allowed = parseAllowedOrigins('https://quiznix.vercel.app')
  assert.equal(
    isOriginAllowed('https://quiznix.vercel.app.evil.com', 'quiznix-ai.onrender.com', allowed),
    false,
  )
  assert.equal(
    isOriginAllowed('https://sub.quiznix.vercel.app', 'quiznix-ai.onrender.com', allowed),
    false,
  )
})

test('origin check: an unparseable Origin is denied', () => {
  assert.equal(isOriginAllowed('not a url', 'app.example.com', NONE), false)
})

test('parseAllowedOrigins: trims, ignores blanks, and normalizes URLs and hostnames', () => {
  const allowed = parseAllowedOrigins(
    ' https://a.example.com/ , b.example.com ,, https://c.example.com ',
  )
  assert.equal(allowed.has('a.example.com'), true)
  assert.equal(allowed.has('https://a.example.com'), true)
  assert.equal(allowed.has('b.example.com'), true)
  assert.equal(allowed.has('c.example.com'), true)
  assert.equal(allowed.has('https://c.example.com'), true)
})

test('parseAllowedOrigins: an empty value yields no entries', () => {
  assert.equal(parseAllowedOrigins(undefined).size, 0)
  assert.equal(parseAllowedOrigins('').size, 0)
  assert.equal(parseAllowedOrigins(' , , ').size, 0)
})
