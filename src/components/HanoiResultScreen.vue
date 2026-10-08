<script lang="ts" setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { MAX_DISKS, optimalMoves } from '../../shared/hanoiRules.mjs'
import { formatDuration } from '../games/hanoi/format'
import ConfettiBurst from './ConfettiBurst.vue'

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
  <div class="mx-auto mt-6 w-full max-w-2xl space-y-4 p-4 sm:p-0">
    <!-- a reward for finishing, not only for beating a record: bigger when the
         solve actually earned something (a minimum-move run or a new best) -->
    <ConfettiBurst
      :particle-count="isPerfect || isNewBest ? 180 : 90"
      :duration-ms="isPerfect || isNewBest ? 3200 : 2200"
    />

    <div class="card bg-base-100 shadow">
      <div class="card-body items-center text-center">
        <h2 class="card-title text-2xl">{{ headline }}</h2>
        <p class="text-sm opacity-70">{{ subline }}</p>
        <div class="mt-1 flex flex-wrap justify-center gap-2">
          <span v-if="isPerfect" class="badge badge-soft badge-success gap-1 py-3">
            <Icon icon="lucide:sparkles" class="h-3.5 w-3.5" />
            Minimum moves
          </span>
          <span v-if="isNewBest" class="badge badge-soft badge-primary gap-1 py-3">
            <Icon icon="lucide:trophy" class="h-3.5 w-3.5" />
            {{ hadPreviousBest ? 'New record' : 'First record' }}
          </span>
        </div>
      </div>
    </div>

    <div class="stats stats-vertical w-full bg-base-200 shadow sm:stats-horizontal">
      <div class="stat">
        <div class="stat-title">Moves</div>
        <div class="stat-value text-3xl tabular-nums">{{ moves }}</div>
        <div class="stat-desc">perfect is {{ optimal }}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Time</div>
        <div class="stat-value text-3xl tabular-nums">{{ formatDuration(ms) }}</div>
        <div class="stat-desc">{{ disks }} disks</div>
      </div>
      <div class="stat">
        <div class="stat-title">Personal best</div>
        <div class="stat-value text-2xl tabular-nums">
          {{ best && hadPreviousBest ? `${best.moves} moves` : '—' }}
        </div>
        <div class="stat-desc">
          {{ hadPreviousBest && best ? formatDuration(best.ms) : 'your first solve here' }}
        </div>
      </div>
    </div>

    <p v-if="hintsUsed > 0" class="text-center text-xs opacity-60">
      {{ hintsUsed }} {{ hintsUsed === 1 ? 'hint' : 'hints' }} used this round.
    </p>

    <div class="flex flex-col gap-2 sm:flex-row">
      <button class="btn btn-soft btn-primary flex-1" @click="emit('replay', { disks })">
        <Icon icon="lucide:rotate-ccw" class="h-4 w-4" />
        Play again
      </button>
      <button
        v-if="canGrow"
        class="btn btn-soft flex-1"
        @click="emit('replay', { disks: nextSize })"
      >
        <Icon icon="lucide:trending-up" class="h-4 w-4" />
        Try {{ nextSize }} disks
      </button>
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <button class="btn btn-ghost flex-1" @click="emit('change-size')">Change size</button>
      <button class="btn btn-ghost flex-1" @click="emit('home')">Back to home</button>
    </div>
  </div>
</template>
