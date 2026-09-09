<script lang="ts" setup>
import { useUselessFact } from '../composables/useUselessFact'

const props = withDefaults(defineProps<{ intervalMs?: number; refreshOnMount?: boolean }>(), {
  intervalMs: 10000,
  refreshOnMount: true,
})

const { fact } = useUselessFact(props.intervalMs, {
  refreshOnMount: props.refreshOnMount,
})
</script>

<template>
  <div
    class="card mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-base-300 bg-base-200 shadow-sm"
  >
    <div class="card-body flex flex-row items-center gap-4 p-6 text-left">
      <!-- Icon / Visual Accent -->
      <div class="shrink-0 rounded-xl bg-primary/10 p-3 text-primary">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <!-- Content -->
      <div class="space-y-1">
        <span
          class="badge badge-primary badge-sm text-[10px] font-semibold uppercase tracking-wider"
        >
          Did You Know?
        </span>
        <p class="break-words text-base font-medium leading-snug text-base-content/90">
          {{ fact }}
        </p>
      </div>
    </div>
  </div>
</template>
