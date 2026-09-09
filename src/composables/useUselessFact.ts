import { onMounted, onUnmounted, ref } from 'vue'

interface UselessFactResponse {
  text?: unknown
}

const API_URL = 'https://uselessfacts.jsph.pl/api/v2/facts/random?language=en'
const CACHE_KEY = 'quiznix-trivia-fact'
const FETCH_TIMEOUT_MS = 3000

// Instant first paint while the API is in flight — also the offline fallback.
const FALLBACK_FACTS = [
  'Honey never spoils. Archaeologists have tasted 3,000-year-old honey from Egyptian tombs.',
  'Octopuses have three hearts and blue blood.',
  'Bananas are berries, but strawberries are not.',
  'A day on Venus is longer than its year.',
  'Sharks existed before trees.',
  'The Eiffel Tower grows about 15 cm taller in summer.',
  'Sea otters hold hands while sleeping so they do not drift apart.',
  'Wombat poop is cube-shaped.',
]

function randomFallback(): string {
  return FALLBACK_FACTS[Math.floor(Math.random() * FALLBACK_FACTS.length)]!
}

function loadCached(): string | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw && raw.trim() !== '') return raw
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

async function fetchRandomFact(signal: AbortSignal): Promise<string | null> {
  const response = await fetch(API_URL, { signal })
  if (!response.ok) return null
  const data = (await response.json()) as UselessFactResponse
  const text = typeof data.text === 'string' ? data.text.trim() : ''
  return text === '' ? null : text
}

/**
 * Rotating "Did you know?" trivia. Never throws and never blocks — the fact
 * starts as a cached/hardcoded value and upgrades to the API value when it
 * arrives. Rotation only runs while the consumer is mounted.
 *
 * Set `refreshOnMount: false` (with `intervalMs: 0`) for a stable one-fact
 * display such as the loading screen — it shows the prefetched cached fact
 * with no mid-read swap. Rotation stays on for long waits like the lobby.
 */
export function useUselessFact(intervalMs = 10000, options: { refreshOnMount?: boolean } = {}) {
  const { refreshOnMount = true } = options
  const fact = ref<string>(loadCached() ?? randomFallback())
  let timer: ReturnType<typeof setInterval> | null = null
  let fetching = false
  let disposed = false
  let controller: AbortController | null = null

  async function refresh() {
    if (fetching || disposed) return
    fetching = true
    controller = new AbortController()
    const timeout = window.setTimeout(() => controller?.abort(), FETCH_TIMEOUT_MS)
    try {
      const text = await fetchRandomFact(controller.signal)
      // Assign only when the text actually differs — avoids a visible
      // flicker/re-render when the API returns the cached fact again.
      if (text && !disposed && text !== fact.value) {
        fact.value = text
        saveCached(text)
      }
    } catch {
      /* keep the current fact — trivia must never break the quiz flow */
    } finally {
      window.clearTimeout(timeout)
      fetching = false
    }
  }

  function stop() {
    disposed = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    controller?.abort()
  }

  onMounted(() => {
    disposed = false
    if (refreshOnMount) {
      void refresh()
    }
    if (intervalMs > 0) {
      timer = setInterval(() => void refresh(), intervalMs)
    }
  })
  onUnmounted(stop)

  return { fact }
}

/**
 * Background prefetch — call while the user is idle (e.g. start-screen mount)
 * so the loading screen opens with a fresh cached fact and needs no mount
 * refresh. Dedupes concurrent calls and never throws.
 */
let inflightPrefetch: Promise<void> | null = null

export function prefetchUselessFact(): Promise<void> {
  if (!inflightPrefetch) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    inflightPrefetch = fetchRandomFact(controller.signal)
      .then((text) => {
        if (text) saveCached(text)
      })
      .catch(() => {
        /* offline/API down — cached/hardcoded fact covers it */
      })
      .finally(() => {
        window.clearTimeout(timeout)
        inflightPrefetch = null
      })
  }
  return inflightPrefetch
}
