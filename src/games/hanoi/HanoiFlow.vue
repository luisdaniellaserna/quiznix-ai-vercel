<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import HanoiScreen from './HanoiScreen.vue'
import HanoiResultScreen from './HanoiResultScreen.vue'
import HanoiSetupScreen from './HanoiSetupScreen.vue'
import { loadBests, recordSolve, saveBests, type HanoiBest } from './bests'
import { clearQuitAction, setQuitAction } from '../../shell/chrome'

type Phase = 'setup' | 'playing' | 'result'

interface Outcome {
  moves: number
  ms: number
  hintsUsed: number
  best: HanoiBest | null
  isNewBest: boolean
  hadPreviousBest: boolean
}

const router = useRouter()
const phase = ref<Phase>('setup')
const disks = ref(4)
const run = ref(0)
const outcome = ref<Outcome | null>(null)

function start(payload: { disks: number }) {
  disks.value = payload.disks
  // a fresh board and clock per run, so "play again" really resets
  run.value += 1
  outcome.value = null
  phase.value = 'playing'
}

function solved(result: { moves: number; ms: number; hintsUsed: number }) {
  const bests = loadBests()
  const hadPreviousBest = Boolean(bests[disks.value])
  const {
    bests: updated,
    best,
    isNewBest,
  } = recordSolve(bests, disks.value, result.moves, result.ms)
  if (isNewBest) saveBests(updated)
  outcome.value = { ...result, best, isNewBest, hadPreviousBest }
  phase.value = 'result'
}

function backToSetup() {
  outcome.value = null
  phase.value = 'setup'
}

function home() {
  void router.push('/')
}

// quitting mid-solve returns to the size picker, so the header's quit only
// exists while there is a solve to abandon
watch(
  phase,
  (value) => {
    if (value === 'playing') setQuitAction('Quit puzzle', backToSetup)
    else clearQuitAction()
  },
  { immediate: true },
)

onUnmounted(clearQuitAction)
</script>

<template>
  <HanoiSetupScreen v-if="phase === 'setup'" @start="start" />

  <HanoiScreen v-else-if="phase === 'playing'" :key="run" :disks="disks" @solved="solved" />

  <HanoiResultScreen
    v-else-if="phase === 'result' && outcome"
    :disks="disks"
    :moves="outcome.moves"
    :ms="outcome.ms"
    :hints-used="outcome.hintsUsed"
    :best="outcome.best"
    :is-new-best="outcome.isNewBest"
    :had-previous-best="outcome.hadPreviousBest"
    @replay="start"
    @change-size="backToSetup"
    @home="home"
  />
</template>
