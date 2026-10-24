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
  <!-- Poster variant: a self-contained bordered plate in the house palette, so
       it reads the same in every theme instead of flashing a white card -->
  <div v-if="props.variant === 'poster'" class="panel mx-auto w-full max-w-xl p-6 sm:p-8">
    <div class="flex items-start justify-between gap-4">
      <div class="select-none">
        <p class="pixel-title text-3xl leading-[1.05] sm:text-4xl">Did you</p>
        <p class="pixel-title text-accent mt-1 text-3xl leading-[1.05] sm:text-4xl">Know?</p>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 72 88"
        class="text-base-content h-20 w-20 shrink-0 sm:h-24 sm:w-24"
        role="img"
        aria-label="Lightbulb"
      >
        <!-- rays -->
        <g stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <line x1="36" y1="2" x2="36" y2="9" />
          <line x1="14" y1="11" x2="19" y2="17" />
          <line x1="58" y1="11" x2="53" y2="17" />
          <line x1="6" y1="29" x2="13" y2="31" />
          <line x1="66" y1="29" x2="59" y2="31" />
        </g>
        <!-- glass -->
        <path
          d="M36 14 C24 14 15 24 15 36 C15 45 20 51 26 55 L26 60 L46 60 L46 55 C52 51 57 45 57 36 C57 24 48 14 36 14 Z"
          fill="var(--color-warning)"
          stroke="currentColor"
          stroke-width="3"
          stroke-linejoin="round"
        />
        <!-- highlight -->
        <path
          d="M22 33 C22 28 25 24 29 22"
          fill="none"
          stroke="var(--color-warning-content)"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.7"
        />
        <!-- filament -->
        <path
          d="M30 60 L30 44 M42 60 L42 44 M30 44 L36 36 L42 44"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <!-- screw base -->
        <rect
          x="26"
          y="62"
          width="20"
          height="6"
          rx="3"
          fill="color-mix(in oklab, var(--color-base-content) 45%, transparent)"
          stroke="currentColor"
          stroke-width="2.5"
        />
        <rect
          x="28"
          y="70"
          width="16"
          height="5"
          rx="2.5"
          fill="color-mix(in oklab, var(--color-base-content) 45%, transparent)"
          stroke="currentColor"
          stroke-width="2.5"
        />
        <rect x="32" y="77" width="8" height="4" rx="2" fill="currentColor" />
      </svg>
    </div>

    <div class="panel-quiet mt-5 px-5 py-6 text-center sm:px-8">
      <p class="eyebrow">Interesting fact</p>
      <p class="text-base-content/70 mt-3 text-sm leading-relaxed break-words sm:text-base">
        {{ fact }}
      </p>
    </div>
  </div>

  <div v-else class="panel-quiet w-full overflow-hidden">
    <div class="flex flex-row items-center gap-4 p-4 text-left">
      <!-- Icon / Visual Accent -->
      <div class="bg-primary/10 text-primary shrink-0 rounded-lg p-3">
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
      <div class="space-y-1.5">
        <span class="eyebrow text-primary text-[10px]">Did You Know?</span>
        <p class="text-base-content/90 text-base leading-snug font-medium break-words">
          {{ fact }}
        </p>
      </div>
    </div>
  </div>
</template>
