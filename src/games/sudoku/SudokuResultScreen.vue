<script lang="ts" setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { DIFFICULTY_LABELS, type Difficulty } from './generator'
import type { SudokuBest } from './bests'
import type { BoardSize } from './rules'
import { formatDuration } from '../shared/format'
import ConfettiBurst from '../../shell/ConfettiBurst.vue'

const props = defineProps<{
  size: BoardSize
  difficulty: Difficulty
  ms: number
  hintsUsed: number
  best: SudokuBest | null
  isNewBest: boolean
  hadPreviousBest: boolean
}>()

const emit = defineEmits<{
  replay: []
  'change-setup': []
  home: []
}>()

const board = computed(
  () => `${props.size}×${props.size} ${DIFFICULTY_LABELS[props.difficulty].toLowerCase()}`,
)
const unaided = computed(() => props.hintsUsed === 0)

const headline = computed(() => {
  if (props.isNewBest && props.hadPreviousBest) return 'New personal best!'
  if (unaided.value) return 'Solved unaided!'
  return 'Puzzle solved!'
})

const subline = computed(() => {
  if (props.isNewBest && props.hadPreviousBest) {
    return `You beat your previous best on the ${board.value} board.`
  }
  if (unaided.value) {
    return `Every cell filled on the ${board.value} board without a single hint.`
  }
  return `You finished the ${board.value} board with ${props.hintsUsed} ${
    props.hintsUsed === 1 ? 'hint' : 'hints'
  }.`
})
</script>

<template>
  <div class="app-container mt-6 w-full max-w-2xl space-y-4 py-10 sm:mx-auto">
    <ConfettiBurst
      :particle-count="isNewBest || unaided ? 170 : 85"
      :duration-ms="isNewBest || unaided ? 3200 : 2200"
    />

    <div class="panel">
      <div class="card-body items-center text-center">
        <p class="eyebrow">Puzzle complete</p>
        <h2 class="pixel-title mt-2 text-2xl">{{ headline }}</h2>
        <p class="mt-2 text-sm opacity-70">{{ subline }}</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
          <span v-if="unaided" class="badge badge-soft badge-success gap-1 py-3">
            <Icon icon="lucide:sparkles" class="h-3.5 w-3.5" aria-hidden="true" />
            No hints
          </span>
          <span v-if="isNewBest" class="badge badge-soft badge-primary gap-1 py-3">
            <Icon icon="lucide:trophy" class="h-3.5 w-3.5" aria-hidden="true" />
            {{ hadPreviousBest ? 'New record' : 'First record' }}
          </span>
        </div>
      </div>
    </div>

    <div class="stats stats-vertical border-base-300 w-full border sm:stats-horizontal">
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Time</div>
        <div class="stat-value pixel-number text-primary text-2xl">{{ formatDuration(ms) }}</div>
        <div class="stat-desc">{{ size }}×{{ size }} board</div>
      </div>
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Hints</div>
        <div class="stat-value pixel-number text-2xl">{{ hintsUsed }}</div>
        <div class="stat-desc">{{ DIFFICULTY_LABELS[difficulty] }}</div>
      </div>
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Personal best</div>
        <div class="stat-value pixel-number text-2xl">
          {{ best && hadPreviousBest ? formatDuration(best.ms) : '—' }}
        </div>
        <div class="stat-desc">
          <template v-if="hadPreviousBest && best">
            {{ best.hints > 0 ? `${best.hints} hints` : 'no hints' }}
          </template>
          <template v-else>your first solve here</template>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row">
      <button class="btn btn-primary flex-1" @click="emit('replay')">
        <Icon icon="lucide:rotate-ccw" class="h-4 w-4" aria-hidden="true" />
        Play another
      </button>
      <button
        class="btn btn-outline border-base-300 flex-1 hover:border-primary hover:bg-base-200"
        @click="emit('change-setup')"
      >
        <Icon icon="lucide:settings-2" class="h-4 w-4" aria-hidden="true" />
        Change board
      </button>
    </div>
    <button class="btn btn-ghost w-full" @click="emit('home')">Back to home</button>
  </div>
</template>
