<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { DIFFICULTIES, DIFFICULTY_LABELS, clueTarget, type Difficulty } from './generator'
import type { BoardSize } from './rules'
import { bestKey, loadBests } from './bests'
import { formatDuration } from '../shared/format'

const emit = defineEmits<{
  start: [payload: { size: BoardSize; difficulty: Difficulty }]
}>()

const SETUP_KEY = 'quiznix-sudoku-setup'
const DEFAULT_SIZE: BoardSize = 9
const DEFAULT_DIFFICULTY: Difficulty = 'easy'

const BOARDS: { size: BoardSize; label: string; blurb: string }[] = [
  { size: 4, label: '4×4', blurb: 'Beginner — a quick round' },
  { size: 9, label: '9×9', blurb: 'Classic — the real thing' },
]

function fallbackDifficulty(size: BoardSize): Difficulty {
  return DIFFICULTIES[size][0]
}

function savedSetup(): { size: BoardSize; difficulty: Difficulty } {
  try {
    const raw = localStorage.getItem(SETUP_KEY)
    if (!raw) return { size: DEFAULT_SIZE, difficulty: DEFAULT_DIFFICULTY }
    const parsed = JSON.parse(raw) as { size?: unknown; difficulty?: unknown }
    const size = Number(parsed.size)
    if (size !== 4 && size !== 9) return { size: DEFAULT_SIZE, difficulty: DEFAULT_DIFFICULTY }
    const difficulty = DIFFICULTIES[size].includes(parsed.difficulty as Difficulty)
      ? (parsed.difficulty as Difficulty)
      : fallbackDifficulty(size)
    return { size, difficulty }
  } catch {
    return { size: DEFAULT_SIZE, difficulty: DEFAULT_DIFFICULTY }
  }
}

const saved = savedSetup()
const size = ref<BoardSize>(saved.size)
const difficulty = ref<Difficulty>(saved.difficulty)
const bests = ref(loadBests())

const difficulties = computed(() => DIFFICULTIES[size.value])
const best = computed(() => bests.value[bestKey(size.value, difficulty.value)] ?? null)

function chooseSize(next: BoardSize) {
  size.value = next
  // the small board only has one setting, so the old difficulty cannot carry over
  if (!DIFFICULTIES[next].includes(difficulty.value)) difficulty.value = fallbackDifficulty(next)
}

function start() {
  try {
    localStorage.setItem(
      SETUP_KEY,
      JSON.stringify({ size: size.value, difficulty: difficulty.value }),
    )
  } catch {
    /* ignore */
  }
  emit('start', { size: size.value, difficulty: difficulty.value })
}
</script>

<template>
  <section class="app-container w-full max-w-2xl py-10 sm:py-14">
    <div class="panel p-6 sm:p-8">
      <p class="eyebrow">Solo puzzle</p>
      <h1 class="pixel-title mt-3 text-2xl">Sudoku</h1>
      <p class="mt-3 text-sm opacity-70">
        Every row, column and box holds each digit exactly once. The board has one solution, the
        clock only measures you, and the pencil marks are there when you need them.
      </p>

      <p class="mt-7 font-mono text-[11px] tracking-[0.18em] uppercase opacity-70">Which board?</p>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          v-for="board in BOARDS"
          :key="board.size"
          type="button"
          class="cursor-pointer rounded-lg border px-4 py-3 text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
          :class="
            board.size === size
              ? 'border-primary bg-primary/10'
              : 'border-base-300 hover:border-primary/60'
          "
          :aria-pressed="board.size === size"
          @click="chooseSize(board.size)"
        >
          <span class="pixel-number block text-xl">{{ board.label }}</span>
          <span class="mt-1 block text-xs opacity-60">{{ board.blurb }}</span>
        </button>
      </div>

      <template v-if="difficulties.length > 1">
        <p class="mt-6 font-mono text-[11px] tracking-[0.18em] uppercase opacity-70">How hard?</p>
        <div class="mt-3 grid grid-cols-3 gap-2">
          <button
            v-for="level in difficulties"
            :key="level"
            type="button"
            class="cursor-pointer rounded-lg border px-2 py-3 text-center transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
            :class="
              level === difficulty
                ? 'border-primary bg-primary/10'
                : 'border-base-300 hover:border-primary/60'
            "
            :aria-pressed="level === difficulty"
            @click="difficulty = level"
          >
            <span class="block text-sm font-semibold">{{ DIFFICULTY_LABELS[level] }}</span>
            <span class="mt-1 block font-mono text-[9px] tracking-[0.1em] uppercase opacity-55">
              {{ clueTarget(9, level) }} clues
            </span>
          </button>
        </div>
      </template>

      <div class="panel-quiet mt-5 p-4 text-sm">
        <p class="font-semibold">{{ size }}×{{ size }} · {{ DIFFICULTY_LABELS[difficulty] }}</p>
        <p class="mt-1 opacity-70">
          <template v-if="best">
            Your best: {{ formatDuration(best.ms) }}
            <template v-if="best.hints > 0"> with {{ best.hints }} hints.</template>
            <template v-else> with no hints.</template>
          </template>
          <template v-else>No record on this setting yet — your first solve sets it.</template>
        </p>
      </div>

      <div class="mt-7 flex flex-col items-stretch gap-2 sm:flex-row">
        <button class="btn btn-primary flex-1 sm:flex-none sm:px-8" @click="start">
          <Icon icon="lucide:play" class="h-4 w-4" aria-hidden="true" />
          Start puzzle
        </button>
        <RouterLink to="/" class="btn btn-ghost flex-1 sm:flex-none">← All games</RouterLink>
      </div>
    </div>
  </section>
</template>
