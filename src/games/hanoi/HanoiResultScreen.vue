<script lang="ts" setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { MAX_DISKS, optimalMoves } from '../../../shared/hanoiRules.mjs'
import { formatDuration } from '../shared/format'
import ConfettiBurst from '../../shell/ConfettiBurst.vue'

const props = defineProps<{
  disks: number
  moves: number
  ms: number
  hintsUsed: number
  best: { moves: number; ms: number } | null
  isNewBest: boolean
  hadPreviousBest: boolean
}>()

const emit = defineEmits<{
  replay: [payload: { disks: number }]
  'change-size': []
  home: []
}>()

const optimal = computed(() => optimalMoves(props.disks))
const isPerfect = computed(() => props.moves === optimal.value)
const nextSize = computed(() => props.disks + 1)
const canGrow = computed(() => props.disks < MAX_DISKS)

const headline = computed(() => {
  if (isPerfect.value) return 'Perfect solve!'
  if (props.isNewBest && props.hadPreviousBest) return 'New personal best!'
  return 'Solved!'
})

const subline = computed(() => {
  if (isPerfect.value) {
    return `Every one of the ${props.disks} disks in the minimum ${optimal.value} moves — the fastest possible route.`
  }
  if (props.isNewBest && props.hadPreviousBest) {
    return `You beat your previous best on ${props.disks} disks.`
  }
  return `Stacked all ${props.disks} disks on the last peg in ${props.moves} moves.`
})
</script>

<template>
  <div class="app-container mt-6 w-full max-w-2xl space-y-4 py-10 sm:mx-auto">
    <!-- a reward for finishing, not only for beating a record: bigger when the
         solve actually earned something (a minimum-move run or a new best) -->
    <ConfettiBurst
      :particle-count="isPerfect || isNewBest ? 180 : 90"
      :duration-ms="isPerfect || isNewBest ? 3200 : 2200"
    />

    <div class="panel">
      <div class="card-body items-center text-center">
        <p class="eyebrow">Puzzle complete</p>
        <h2 class="pixel-title mt-2 text-2xl">{{ headline }}</h2>
        <p class="mt-2 text-sm opacity-70">{{ subline }}</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
          <span v-if="isPerfect" class="badge badge-soft badge-success gap-1 py-3">
            <Icon icon="lucide:sparkles" class="h-3.5 w-3.5" aria-hidden="true" />
            Minimum moves
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
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Moves</div>
        <div class="stat-value pixel-number text-primary text-2xl">{{ moves }}</div>
        <div class="stat-desc">perfect is {{ optimal }}</div>
      </div>
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Time</div>
        <div class="stat-value pixel-number text-2xl">{{ formatDuration(ms) }}</div>
        <div class="stat-desc">{{ disks }} disks</div>
      </div>
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Personal best</div>
        <div class="stat-value pixel-number text-2xl">
          {{ best && hadPreviousBest ? `${best.moves} moves` : '—' }}
        </div>
        <div class="stat-desc">
          {{ hadPreviousBest && best ? formatDuration(best.ms) : 'your first solve here' }}
        </div>
      </div>
    </div>

    <p
      v-if="hintsUsed > 0"
      class="text-center font-mono text-[10px] uppercase tracking-[0.16em] opacity-55"
    >
      {{ hintsUsed }} {{ hintsUsed === 1 ? 'hint' : 'hints' }} used this round.
    </p>

    <div class="flex flex-col gap-2 sm:flex-row">
      <button class="btn btn-primary flex-1" @click="emit('replay', { disks })">
        <Icon icon="lucide:rotate-ccw" class="h-4 w-4" aria-hidden="true" />
        Play again
      </button>
      <button
        v-if="canGrow"
        class="btn btn-outline border-base-300 flex-1 hover:border-primary hover:bg-base-200"
        @click="emit('replay', { disks: nextSize })"
      >
        <Icon icon="lucide:trending-up" class="h-4 w-4" aria-hidden="true" />
        Try {{ nextSize }} disks
      </button>
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <button class="btn btn-ghost flex-1" @click="emit('change-size')">Change size</button>
      <button class="btn btn-ghost flex-1" @click="emit('home')">Back to home</button>
    </div>
  </div>
</template>
