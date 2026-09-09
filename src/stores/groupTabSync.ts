/**
 * Cross-tab coordination for the group quiz room — exactly one tab per browser
 * may hold an active room session at a time. Without this guard, opening a new
 * tab (or following a join link) silently shadows the previous tab's session
 * because the join/create flows rewrite the room store state on every call.
 *
 * Approach:
 *  - Each tab writes a per-tab id into sessionStorage (already per-tab, no
 *    coordination needed).
 *  - The active session is mirrored to localStorage with the tabId, so other
 *    tabs can detect it via the storage event.
 *  - A heartbeat refreshes `lastSeen` so a crashed tab's stale entry is
 *    recognized as dead after ~30s instead of blocking forever.
 *  - When forcing a takeover, the requesting tab writes a one-shot "evict"
 *    hint with the victim's tabId. The victim's `storage` listener drops its
 *    session and surfaces a toast.
 */

const TAB_ID_KEY = 'quiznix-tab-id'
const ACTIVE_SESSION_KEY = 'quiznix-active-group'
const TAB_EVICT_PREFIX = 'quiznix-tab-evict:'
const HEARTBEAT_MS = 5_000
const STALE_MS = 30_000

export interface ActiveGroupSession {
  tabId: string
  code: string
  role: 'host' | 'player'
  playerName?: string
  lastSeen: number
}

/**
 * UUID v4 without requiring a secure context. `crypto.randomUUID` is undefined
 * over plain-HTTP LAN play (how phones join a room), so fall back to
 * `getRandomValues` (available in insecure contexts) and `Math.random` last.
 * The optional source parameter exists for tests.
 */
export interface RandomSource {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array) => void
}

export function randomId(source?: RandomSource): string {
  const c = source ?? (globalThis as { crypto?: RandomSource }).crypto
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function ensureTabId(): string {
  let id = sessionStorage.getItem(TAB_ID_KEY)
  if (!id) {
    id = `tab-${randomId()}`
    try {
      sessionStorage.setItem(TAB_ID_KEY, id)
    } catch {
      /* sessionStorage unavailable — fall back to a per-load id; coordination degrades */
    }
  }
  return id
}

export const tabId = ensureTabId()

export function getActiveSession(): ActiveGroupSession | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ActiveGroupSession
    if (!parsed.tabId || !parsed.code || !parsed.role) return null
    return parsed
  } catch {
    return null
  }
}

/** Returns the live blocking session (a different tab holding an active room), or null. */
export function getBlockingSession(): (ActiveGroupSession & { ageMs: number }) | null {
  const s = getActiveSession()
  if (!s) return null
  if (s.tabId === tabId) return null
  const ageMs = Date.now() - s.lastSeen
  if (ageMs > STALE_MS) return null // stale — treat as dead so a crashed tab doesn't lock out the user
  return { ...s, ageMs }
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null

export function claimActiveSession(session: Omit<ActiveGroupSession, 'tabId' | 'lastSeen'>) {
  try {
    const payload: ActiveGroupSession = {
      ...session,
      tabId,
      lastSeen: Date.now(),
    }
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(payload))
  } catch {
    /* localStorage unavailable — best-effort */
  }
  if (!heartbeatTimer && typeof window !== 'undefined') {
    heartbeatTimer = setInterval(refreshHeartbeat, HEARTBEAT_MS)
  }
}

export function refreshHeartbeat() {
  const s = getActiveSession()
  if (!s || s.tabId !== tabId) {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    return
  }
  try {
    localStorage.setItem(
      ACTIVE_SESSION_KEY,
      JSON.stringify({ ...s, lastSeen: Date.now() }),
    )
  } catch {
    /* ignore */
  }
}

export function releaseActiveSession() {
  const s = getActiveSession()
  if (s && s.tabId === tabId) {
    try {
      localStorage.removeItem(ACTIVE_SESSION_KEY)
    } catch {
      /* ignore */
    }
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/** Ask the other tab to drop its session, then we take over. */
export function evictOtherTab(victimTabId: string) {
  try {
    localStorage.setItem(`${TAB_EVICT_PREFIX}${victimTabId}`, String(Date.now()))
    // remove the marker shortly after so it fires once per `storage` event
    setTimeout(() => {
      try {
        localStorage.removeItem(`${TAB_EVICT_PREFIX}${victimTabId}`)
      } catch {
        /* ignore */
      }
    }, 1000)
  } catch {
    /* ignore */
  }
}

/** Subscribe to "you've been evicted" notifications. Returns an unsubscribe fn. */
export function onEvicted(handler: () => void) {
  if (typeof window === 'undefined') return () => {}
  const target = `${TAB_EVICT_PREFIX}${tabId}`
  function onStorage(e: StorageEvent) {
    if (e.key === target && e.newValue) {
      handler()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

/** Run cleanup on tab close (best-effort — crashes won't fire this). */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    releaseActiveSession()
  })
}
