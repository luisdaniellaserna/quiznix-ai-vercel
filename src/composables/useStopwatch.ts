import { onUnmounted, ref } from 'vue'

/**
 * Count-up stopwatch for the Tower of Hanoi solve timer.
 *
 * Deliberately not `useCountdown`: that one counts down to a deadline and the
 * quiz uses it to cut questions short. Here the clock never ends the game — it
 * just measures the solve, because time is the tie-break when two players used
 * the same number of moves.
 *
 * It also does not pause when the tab loses focus: walking away mid-solve
 * should not stop the clock.
 */
export function useStopwatch() {
  const elapsedMs = ref(0)
  const running = ref(false)
  let startedAt = 0
  let timer: ReturnType<typeof setInterval> | null = null

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function tick() {
    if (running.value) elapsedMs.value = Date.now() - startedAt
  }

  function start() {
    stopTimer()
    startedAt = Date.now()
    elapsedMs.value = 0
    running.value = true
    timer = setInterval(tick, 100)
  }

  /** Freezes the clock and returns the final elapsed time. */
  function stop(): number {
    tick()
    running.value = false
    stopTimer()
    return elapsedMs.value
  }

  function reset() {
    stopTimer()
    startedAt = 0
    elapsedMs.value = 0
    running.value = false
  }

  onUnmounted(stopTimer)

  return { elapsedMs, running, start, stop, reset }
}
