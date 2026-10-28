<script lang="ts" setup>
import { useCountdown } from '../composables/useCountdown'

const props = defineProps<{ deadline: number | null; cancellable?: boolean }>()
const emit = defineEmits<{ cancel: [] }>()

const countdown = useCountdown(() => props.deadline)
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-base-100/85 p-4 backdrop-blur-sm"
  >
    <div class="panel w-full max-w-sm">
      <div class="card-body items-center gap-3 text-center">
        <span class="pixel-chip">Starting in</span>
        <div class="pixel-number text-6xl leading-none">{{ countdown.remaining.value }}</div>
        <progress
          class="progress progress-primary w-full"
          :value="countdown.remaining.value"
          max="5"
        />
        <p class="text-sm opacity-70">Get ready — first question is coming…</p>
        <button v-if="cancellable" class="btn btn-ghost btn-sm" @click="emit('cancel')">
          Cancel start
        </button>
      </div>
    </div>
  </div>
</template>
