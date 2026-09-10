import { onMounted, onUnmounted, ref } from 'vue'
import { CURATED_FACTS, isFactAppropriate } from '../data/curatedFacts'

const CACHE_KEY = 'quiznix-trivia-fact'

// Pre-filtered once at module load so rotation never touches an unsuitable entry.
const SAFE_FACTS = CURATED_FACTS.filter(isFactAppropriate)
const FALLBACK_FACT =
  SAFE_FACTS[0] ?? 'Honey never spoils — archaeologists have tasted 3,000-year-old honey.'

function shuffledIndexes(): number[] {
  const order = SAFE_FACTS.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

function randomFact(except?: string): string {
  const pool = SAFE_FACTS.filter((f) => f !== except)
  const source = pool.length > 0 ? pool : SAFE_FACTS
  return source[Math.floor(Math.random() * source.length)] ?? FALLBACK_FACT
}

function loadCached(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    // Legacy cache may hold a fact from the old unmoderated API — only reuse
    // it when it passes today's content filter, otherwise discard it.
    if (raw && isFactAppropriate(raw)) return raw.trim()
    if (raw) localStorage.removeItem(CACHE_KEY)
  } catch {
    /* storage unavailable — fall through to a hardcoded fact */
  }
  return null
}

function saveCached(fact: string): void {
  try {
    localStorage.setItem(CACHE_KEY, fact)
  } catch {
    /* storage unavailable — trivia still works, just without caching */
  }
}

/**
 * Rotating "Did you know?" trivia from a moderated, general-audience bank
 * (see `src/data/curatedFacts.ts`). Never throws, never blocks, never hits
 * the network — the fact starts as a cached/curated value and rotates on a
 * timer while the consumer is mounted. Rotation never repeats the outgoing
 * fact back-to-back.
 *
 * Set `refreshOnMount: false` (with `intervalMs: 0`) for a stable one-fact
 * display such as the loading screen. Rotation stays on for long waits like
 * the lobby.
 */
export function useUselessFact(intervalMs = 10000, options: { refreshOnMount?: boolean } = {}) {
  const { refreshOnMount = true } = options
  const fact = ref<string>(loadCached() ?? randomFact())
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false
  let queue = shuffledIndexes()

  function next(): void {
    if (disposed || SAFE_FACTS.length === 0) return
    if (queue.length === 0) queue = shuffledIndexes()
    let candidate = SAFE_FACTS[queue.shift()!]!
    // Never show the same fact twice in a row (matters when the deck reshuffles).
    if (candidate === fact.value && SAFE_FACTS.length > 1) {
      if (queue.length === 0) queue = shuffledIndexes()
      candidate = SAFE_FACTS[queue.shift()!]!
      if (candidate === fact.value) candidate = randomFact(fact.value)
    }
    if (candidate !== fact.value) {
      fact.value = candidate
      saveCached(candidate)
    }
  }

  function stop() {
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onMounted(() => {
    disposed = false
    if (refreshOnMount) {
      next()
    }
    if (intervalMs > 0) {
      timer = setInterval(next, intervalMs)
    }
  })
  onUnmounted(stop)

  return { fact }
}

/**
 * Background prime — call while the user is idle (e.g. start-screen mount)
 * so the loading screen opens with a validated cached fact. Never throws.
 */
let primed = false

export function prefetchUselessFact(): Promise<void> {
  if (!primed) {
    primed = true
    try {
      if (!loadCached()) saveCached(randomFact())
    } catch {
      /* trivia degrades to the hardcoded fallback */
    }
  }
  return Promise.resolve()
}
