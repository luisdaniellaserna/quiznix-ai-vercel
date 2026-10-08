<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { MAX_DISKS, MIN_DISKS, optimalMoves } from '../../../shared/hanoiRules.mjs'
import { formatDuration } from './format'
import { loadBests } from './bests'

const emit = defineEmits<{
  start: [payload: { disks: number }]
}>()

const SETUP_KEY = 'quiznix-hanoi-setup'
const MIN_DEFAULT_DISKS = 4

function savedDisks(): number {
  try {
    const raw = localStorage.getItem(SETUP_KEY)
    if (!raw) return MIN_DEFAULT_DISKS
    const parsed = JSON.parse(raw) as { disks?: number }
    const disks = Number(parsed.disks)
    if (Number.isInteger(disks) && disks >= MIN_DISKS && disks <= MAX_DISKS) return disks
  } catch {
    /* ignore */
  }
  return MIN_DEFAULT_DISKS
}

const disks = ref(savedDisks())
const bests = ref(loadBests())
const diskOptions = Array.from({ length: MAX_DISKS - MIN_DISKS + 1 }, (_, i) => MIN_DISKS + i)
const best = computed(() => bests.value[disks.value] ?? null)

function start() {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify({ disks: disks.value }))
  } catch {
    /* ignore */
  }
  emit('start', { disks: disks.value })
}
</script>

<template>
  <section class="mx-auto w-full max-w-2xl">
    <div class="rounded-2xl bg-base-100 p-6 shadow-xl sm:p-8">
      <h1 class="text-2xl font-black tracking-tight">Tower of Hanoi</h1>
      <p class="mt-2 text-sm opacity-70">
        Move the whole stack to the far right peg. A larger disk never sits on a smaller one. The
        clock runs while you solve — it measures you, it never stops you.
      </p>

      <p class="mt-6 text-sm font-semibold">How many disks?</p>
      <div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <button
          v-for="size in diskOptions"
          :key="size"
          type="button"
          class="cursor-pointer rounded-xl border-2 px-2 py-3 text-center transition"
          :class="
            size === disks
              ? 'border-primary bg-primary/10'
              : 'border-base-300 hover:border-primary/60'
          "
          :aria-pressed="size === disks"
          @click="disks = size"
        >
          <span class="block text-xl font-black">{{ size }}</span>
          <span class="block text-[10px] font-medium opacity-60">
            {{ optimalMoves(size) }} moves
          </span>
        </button>
      </div>

      <div class="mt-5 rounded-xl border border-base-300 bg-base-200/50 p-4 text-sm">
        <p class="font-semibold">Perfect solve: {{ optimalMoves(disks) }} moves</p>
        <p class="mt-1 opacity-70">
          <template v-if="best">
            Your best on {{ disks }} disks: {{ best.moves }} moves in {{ formatDuration(best.ms) }}.
          </template>
          <template v-else>No record on {{ disks }} disks yet — your first solve sets it.</template>
        </p>
      </div>

      <div class="mt-6 flex flex-col items-stretch gap-2 sm:flex-row">
        <button class="btn btn-soft btn-primary flex-1" @click="start">
          <Icon icon="lucide:play" class="h-4 w-4" />
          Start puzzle
        </button>
        <RouterLink to="/" class="btn btn-ghost flex-1 sm:flex-none">← All games</RouterLink>
      </div>
    </div>
  </section>
</template>
