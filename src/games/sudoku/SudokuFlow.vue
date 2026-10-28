<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import SudokuSetupScreen from './SudokuSetupScreen.vue'
import SudokuScreen from './SudokuScreen.vue'
import SudokuResultScreen from './SudokuResultScreen.vue'
import { bestKey, loadBests, recordSolve, saveBests, type SudokuBest } from './bests'
import { DIFFICULTY_LABELS, generatePuzzle, type Difficulty, type Puzzle } from './generator'
import type { BoardSize } from './rules'
import {
  clearGameContext,
  clearQuitAction,
  setGameContext,
  setQuitAction,
} from '../../shell/chrome'

type Phase = 'setup' | 'playing' | 'result'

interface Outcome {
  ms: number
  hintsUsed: number
  best: SudokuBest | null
  isNewBest: boolean
  hadPreviousBest: boolean
}

const router = useRouter()
const phase = ref<Phase>('setup')
const size = ref<BoardSize>(9)
const difficulty = ref<Difficulty>('easy')
const puzzle = ref<Puzzle | null>(null)
const outcome = ref<Outcome | null>(null)
/** Bumped per run so a replay mounts a clean board instead of reusing state. */
const run = ref(0)

function start(payload: { size: BoardSize; difficulty: Difficulty }) {
  size.value = payload.size
  difficulty.value = payload.difficulty
  puzzle.value = generatePuzzle({ size: payload.size, difficulty: payload.difficulty })
  run.value += 1
  outcome.value = null
  phase.value = 'playing'
}

function solved(result: { ms: number; hintsUsed: number }) {
  const key = bestKey(size.value, difficulty.value)
  const bests = loadBests()
  const hadPreviousBest = Boolean(bests[key])
  const { bests: updated, best, isNewBest } = recordSolve(bests, key, result.ms, result.hintsUsed)
  if (isNewBest) saveBests(updated)
  outcome.value = { ...result, best, isNewBest, hadPreviousBest }
  phase.value = 'result'
}

/** A new puzzle on the same setting, so "play again" really is a new board. */
function replay() {
  start({ size: size.value, difficulty: difficulty.value })
}

function backToSetup() {
  outcome.value = null
  phase.value = 'setup'
}

function home() {
  void router.push('/')
}

// quitting mid-solve returns to the board picker, so the header's quit only
// exists while there is a puzzle to abandon
watch(
  phase,
  (value) => {
    if (value === 'playing') {
      setQuitAction('Quit puzzle', backToSetup)
      setGameContext(`${size.value}×${size.value} · ${DIFFICULTY_LABELS[difficulty.value]}`)
    } else {
      clearQuitAction()
      clearGameContext()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  clearQuitAction()
  clearGameContext()
})
</script>

<template>
  <SudokuSetupScreen v-if="phase === 'setup'" @start="start" />

  <SudokuScreen
    v-else-if="phase === 'playing' && puzzle"
    :key="run"
    :puzzle="puzzle"
    @solved="solved"
  />

  <SudokuResultScreen
    v-else-if="phase === 'result' && outcome"
    :size="size"
    :difficulty="difficulty"
    :ms="outcome.ms"
    :hints-used="outcome.hintsUsed"
    :best="outcome.best"
    :is-new-best="outcome.isNewBest"
    :had-previous-best="outcome.hadPreviousBest"
    @replay="replay"
    @change-setup="backToSetup"
    @home="home"
  />
</template>
