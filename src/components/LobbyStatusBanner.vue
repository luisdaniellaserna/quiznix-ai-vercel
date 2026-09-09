<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { HostStatus } from '../stores/groupStore'

const props = defineProps<{
  status: HostStatus
  detail?: string
  topic?: string
  quizReady: boolean
  hostOnline?: boolean
  hostOfflineExpiresAt?: number
}>()

// Recomputed from the absolute server expiry on every tick/focus — never a
// decremented counter, so throttled mobile timers can't drift it.
const nowMs = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

function refreshNow() {
  nowMs.value = Date.now()
}

onMounted(() => {
  ticker = setInterval(refreshNow, 1000)
  window.addEventListener('focus', refreshNow)
  document.addEventListener('visibilitychange', refreshNow)
})

onUnmounted(() => {
  if (ticker) clearInterval(ticker)
  window.removeEventListener('focus', refreshNow)
  document.removeEventListener('visibilitychange', refreshNow)
})

const hostOfflineSecs = computed(() => {
  if (props.hostOnline !== false || !props.hostOfflineExpiresAt) return 0
  return Math.max(0, Math.ceil((props.hostOfflineExpiresAt - nowMs.value) / 1000))
})

const label = computed(() => {
  if (!props.quizReady) return 'Generating questions…'
  switch (props.status) {
    case 'choosing-topic':
      return props.detail ? `Host is editing: ${props.detail}` : 'Host is choosing a topic…'
    case 'generating':
      return props.detail
        ? `Generating questions (${props.detail})…`
        : `Generating questions${props.topic ? ` for "${props.topic}"` : ''}…`
    case 'countdown':
      return 'Get ready — game starting!'
    case 'started':
      return 'Game started'
    default:
      return 'Waiting for the host to start the game…'
  }
})
</script>

<template>
  <div class="alert py-2" :class="status === 'countdown' ? 'alert-error' : 'alert-info'">
    <span class="text-sm font-medium">{{ label }}</span>
  </div>
  <div v-if="hostOnline === false" class="alert alert-warning py-2">
    <span class="text-sm font-medium">
      Host offline — waiting to reconnect ({{ hostOfflineSecs }}s). The game resumes when they're
      back.
    </span>
  </div>
</template>
