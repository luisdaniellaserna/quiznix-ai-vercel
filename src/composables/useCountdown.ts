import { computed, onUnmounted, ref, watch } from 'vue'

/**
 * Tracks seconds remaining until a deadline (ms epoch).
 * The getter is watched so a new question deadline restarts the countdown.
 */
export function useCountdown(deadline: () => number | null) {
  const remaining = ref(0)
  const expired = computed(() => remaining.value <= 0)
  let timer: ReturnType<typeof setInterval> | null = null

  function tick() {
    const target = deadline()
    remaining.value = target ? Math.max(0, Math.ceil((target - Date.now()) / 1000)) : 0
    if (remaining.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  watch(
    deadline,
    (target) => {
      stop()
      if (target) {
        tick()
        timer = setInterval(tick, 500)
      }
    },
    { immediate: true },
  )

  onUnmounted(stop)

  return { remaining, expired }
}
