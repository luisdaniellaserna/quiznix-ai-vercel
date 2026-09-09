<script lang="ts" setup>
import { useCountdown } from '../composables/useCountdown'

const props = defineProps<{ deadline: number | null; cancellable?: boolean }>()
const emit = defineEmits<{ cancel: [] }>()

const countdown = useCountdown(() => props.deadline)
</script>

<template>
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
    <div class="card w-full max-w-sm bg-base-100 shadow-2xl">
      <div class="card-body items-center gap-2 text-center">
        <span class="badge badge-error">Starting in</span>
        <div class="text-6xl font-black tabular-nums">{{ countdown.remaining.value }}</div>
        <progress
          class="progress progress-error w-full"
          :value="countdown.remaining.value"
          max="5"
        />
        <p class="text-sm opacity-70">Get ready — first question is coming…</p>
        <button v-if="cancellable" class="btn btn-soft btn-sm" @click="emit('cancel')">
          Cancel start
        </button>
      </div>
    </div>
  </div>
</template>
