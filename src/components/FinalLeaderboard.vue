<script lang="ts" setup>
import { computed } from 'vue'
import type { LeaderboardEntry } from '../groupProtocol'

const props = defineProps<{
  entries: LeaderboardEntry[]
  highlightName?: string
}>()

const isHighlight = (entry: LeaderboardEntry) =>
  props.highlightName !== undefined &&
  props.highlightName !== '' &&
  entry.name === props.highlightName

function rowClass(entry: LeaderboardEntry, index: number): string {
  const base = 'flex items-center gap-3 rounded-lg border'
  const highlight = isHighlight(entry)
    ? ' ring-2 ring-primary ring-offset-1 ring-offset-base-100'
    : ''
  if (index === 0) return `${base} border-warning/60 bg-warning/10 p-5 sm:scale-[1.02]${highlight}`
  if (index === 1) return `${base} border-base-300 bg-base-200/70 p-4${highlight}`
  if (index === 2) return `${base} border-[#cd7f32]/50 bg-[#cd7f32]/10 p-4${highlight}`
  return `${base} border-base-300 p-3 text-sm opacity-80${highlight}`
}

function rankBadgeClass(index: number): string {
  if (index === 0) return 'bg-warning text-warning-content h-10 w-10 text-lg'
  if (index === 1) return 'bg-base-300 text-base-content h-9 w-9'
  if (index === 2) return 'bg-[#cd7f32] text-white h-9 w-9'
  return 'bg-base-300 text-base-content h-8 w-8 text-sm'
}

function formatTime(ms: number) {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`
}

const showDividerAfter = computed(() => props.entries.length > 4)
</script>

<template>
  <ul class="mt-4 grid gap-2">
    <template v-for="(entry, index) in entries" :key="entry.name + index">
      <li :class="rowClass(entry, index)">
        <span
          class="pixel-number flex shrink-0 items-center justify-center rounded-md"
          :class="rankBadgeClass(index)"
        >
          {{ index + 1 }}
        </span>
        <span class="min-w-0">
          <span class="flex items-center gap-2">
            <span class="truncate font-bold" :class="index === 0 ? 'text-lg' : ''">
              {{ entry.name }}
            </span>
            <span v-if="isHighlight(entry)" class="badge badge-primary badge-sm">you</span>
          </span>
          <span
            v-if="index === 0"
            class="text-warning mt-0.5 block font-mono text-[10px] font-semibold tracking-[0.2em] uppercase"
          >
            Winner
          </span>
        </span>
        <span class="ml-auto shrink-0 text-right">
          <span class="pixel-number block" :class="index < 3 ? 'text-base' : ''">
            {{ (entry.score / 1000).toFixed(1) }} pts
          </span>
          <span class="block text-xs opacity-60">
            {{ entry.correct }}/{{ entry.total }} correct · {{ formatTime(entry.timeSpentMs) }}
          </span>
        </span>
      </li>
      <li
        v-if="index === 2 && showDividerAfter"
        aria-hidden="true"
        class="border-base-300 mx-2 border-t border-dashed"
      />
    </template>
  </ul>
</template>
