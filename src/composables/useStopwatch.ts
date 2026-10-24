import { onUnmounted, ref } from 'vue'

/**
 * Count-up stopwatch for a solo puzzle solve.
 *
 * Deliberately not `useCountdown`: that one counts down to a deadline and the
 * quiz uses it to cut questions short. Here the clock never ends the game — it
 * just measures the solve, because time is what a personal best is ranked by.
 *
 * The clock is idle until play actually starts (`startOnce`), so time spent
 * reading the screen or hunting for the controls is not counted against you.
 *
 * It also does not pause when the tab loses focus: walking away mid-solve
 * should not stop the clock.
 */
export function useStopwatch() {
  const elapsedMs = ref(0)
  const started = ref(false)
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | null = null

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function tick() {
    if (started.value) elapsedMs.value = Date.now() - startedAt
  }

  function start() {
    stopTimer()
    startedAt = Date.now()
    elapsedMs.value = 0
    started.value = true
    timer = setInterval(tick, 100)
  }

  /**
   * Starts the clock on the first real interaction, and does nothing after
   * that. Restarting later would silently reset a solve in progress.
   */
  function startOnce() {
    if (!started.value) start()
  }

  /** Freezes the clock and returns the final elapsed time. */
  function stop(): number {
    tick()
    started.value = false
    stopTimer()
    return elapsedMs.value
  }

  function reset() {
    stopTimer()
    startedAt = 0
    elapsedMs.value = 0
    started.value = false
  }

  onUnmounted(stopTimer)

  return { elapsedMs, startOnce, stop, reset }
}
