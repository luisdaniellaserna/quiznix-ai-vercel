<script lang="ts" setup>
import type { PlayerInfo } from '../groupProtocol'

defineProps<{
  players: PlayerInfo[]
  maxPlayers: number
  selfId?: string | null
  isHost: boolean
}>()

const emit = defineEmits<{ kick: [playerId: string] }>()
</script>

<template>
  <div class="card bg-base-200/60 shadow-xl">
    <div class="card-body gap-3 p-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold uppercase tracking-wider opacity-70">Players</h3>
        <span class="badge badge-sm">{{ players.length }} / {{ maxPlayers }}</span>
      </div>
      <div v-if="players.length === 0" class="text-sm opacity-60">Waiting for players…</div>
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
              class="btn btn-soft btn-error btn-xs text-error"
              :aria-label="`Kick ${p.name}`"
              @click="emit('kick', p.playerId)"
            >
              Kick
            </button>
          </div>
        </li>
      </ul>
      <p class="text-xs opacity-60">
        {{ players.filter((p) => p.ready).length }} / {{ players.length }} ready
      </p>
    </div>
  </div>
</template>
