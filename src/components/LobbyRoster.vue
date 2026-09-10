<script lang="ts" setup>
import { computed } from 'vue'
import type { PlayerInfo } from '../groupProtocol'

const props = defineProps<{
  players: PlayerInfo[]
  maxPlayers: number
  selfId?: string | null
  isHost: boolean
}>()

const emit = defineEmits<{ kick: [playerId: string] }>()

const readyCount = computed(() => props.players.filter((p) => p.ready).length)
</script>

<template>
  <div class="card bg-base-200/60 shadow-xl">
    <div class="card-body gap-3 p-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-bold uppercase tracking-wider opacity-70">
          Players ({{ players.length }}/{{ maxPlayers }})
        </h3>
        <span
          v-if="players.length > 0"
          class="badge badge-sm"
          :class="readyCount === players.length ? 'badge-success' : 'badge-warning'"
          >{{ readyCount }}/{{ players.length }} ready</span
        >
      </div>
      <div
        v-if="players.length === 0"
        class="flex flex-col items-center gap-1 rounded-xl border border-dashed border-base-300 px-4 py-6 text-center"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 opacity-40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" x2="19" y1="8" y2="14" />
          <line x1="22" x2="16" y1="11" y2="11" />
        </svg>
        <p class="text-sm font-medium opacity-70">Waiting for players to join</p>
        <p class="text-xs opacity-50">Share the room code or QR code</p>
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="p in players"
          :key="p.playerId"
          class="flex items-center justify-between gap-2 rounded-xl border border-base-300 bg-base-100 px-3 py-2"
        >
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate font-semibold">
              👤 {{ p.name }}
              <span v-if="selfId && p.playerId === selfId" class="badge badge-primary badge-xs ml-1"
                >you</span
              >
              <span v-if="!p.connected" class="badge badge-ghost badge-xs ml-1">offline</span>
            </span>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="badge badge-sm" :class="p.ready ? 'badge-success' : 'badge-warning'">
              {{ p.ready ? 'Ready' : 'Not ready' }}
            </span>
            <button
              v-if="isHost"
              class="btn btn-soft btn-error btn-xs"
              :aria-label="`Kick ${p.name}`"
              @click="emit('kick', p.playerId)"
            >
              Kick
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>
