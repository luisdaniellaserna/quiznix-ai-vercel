<script lang="ts" setup>
import { useUselessFact } from '../composables/useUselessFact'

const props = withDefaults(
  defineProps<{ intervalMs?: number; refreshOnMount?: boolean; variant?: 'card' | 'poster' }>(),
  { intervalMs: 10000, refreshOnMount: true, variant: 'card' },
)

const { fact } = useUselessFact(props.intervalMs, {
  refreshOnMount: props.refreshOnMount,
})
</script>

<template>
  <!-- Poster variant: self-contained light card so it looks the same in every theme -->
  <div
    v-if="props.variant === 'poster'"
    class="mx-auto w-full max-w-xl rounded-3xl bg-white p-6 text-neutral-900 shadow-xl sm:p-8"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="select-none uppercase">
        <p class="text-5xl font-black leading-[0.85] tracking-tight sm:text-6xl">Did you</p>
        <p class="text-5xl font-black leading-[0.85] tracking-tight text-amber-400 sm:text-6xl">
          Know?
        </p>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 72 88"
        class="h-20 w-20 shrink-0 sm:h-24 sm:w-24"
        role="img"
        aria-label="Lightbulb"
      >
        <!-- rays -->
        <g stroke="#1c1917" stroke-width="3" stroke-linecap="round">
          <line x1="36" y1="2" x2="36" y2="9" />
          <line x1="14" y1="11" x2="19" y2="17" />
          <line x1="58" y1="11" x2="53" y2="17" />
          <line x1="6" y1="29" x2="13" y2="31" />
          <line x1="66" y1="29" x2="59" y2="31" />
        </g>
        <!-- glass -->
        <path
          d="M36 14 C24 14 15 24 15 36 C15 45 20 51 26 55 L26 60 L46 60 L46 55 C52 51 57 45 57 36 C57 24 48 14 36 14 Z"
          fill="#fbbf24"
          stroke="#1c1917"
          stroke-width="3"
          stroke-linejoin="round"
        />
        <!-- highlight -->
        <path
          d="M22 33 C22 28 25 24 29 22"
          fill="none"
          stroke="#ffffff"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.85"
        />
        <!-- filament -->
        <path
          d="M30 60 L30 44 M42 60 L42 44 M30 44 L36 36 L42 44"
          fill="none"
          stroke="#1c1917"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- screw base -->
        <rect x="26" y="62" width="20" height="6" rx="3" fill="#94a3b8" stroke="#1c1917" stroke-width="2.5" />
        <rect x="28" y="70" width="16" height="5" rx="2.5" fill="#94a3b8" stroke="#1c1917" stroke-width="2.5" />
        <rect x="32" y="77" width="8" height="4" rx="2" fill="#1c1917" />
      </svg>
    </div>

    <div class="mt-4 rounded-2xl border-2 border-neutral-900 px-5 py-6 text-center sm:px-8">
      <p class="text-sm font-extrabold uppercase tracking-[0.25em]">Interesting fact</p>
      <p class="mt-3 break-words text-sm leading-relaxed text-neutral-700 sm:text-base">
        {{ fact }}
      </p>
    </div>
  </div>

  <div
    v-else
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
