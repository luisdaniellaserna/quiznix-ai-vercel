<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import HanoiScreen from './HanoiScreen.vue'
import LobbyRoster from '../../components/LobbyRoster.vue'
import CountdownOverlay from '../../components/CountdownOverlay.vue'
import { useHanoiRaceStore } from '../../stores/hanoiRaceStore'
import { formatDuration } from './format'
import type { Move } from '../../../shared/hanoiRules.mjs'

const emit = defineEmits<{ leave: [] }>()

const store = useHanoiRaceStore()

const draft = ref('')
const localMs = ref(0)

const finished = computed(() => store.standings.filter((e) => e.status === 'finished'))
const stillRacing = computed(() => store.standings.filter((e) => e.status === 'pending'))
const canStart = computed(() => store.canStart)
const needMorePlayers = computed(() => store.players.length < 2)

function onSolved(result: { moves: number; ms: number; hintsUsed: number; moveLog: Move[] }) {
  localMs.value = result.ms
  store.finish(result.moveLog, result.hintsUsed)
}

function send() {
  if (!draft.value.trim()) return
  store.sendChat(draft.value)
  draft.value = ''
}

function leave() {
  emit('leave')
}

function statusLabel(status: 'finished' | 'dnf' | 'pending') {
  if (status === 'finished') return 'Finished'
  if (status === 'dnf') return 'Did not finish'
  return 'Racing…'
}
</script>

<template>
  <section class="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-0">
    <!-- connection -->
    <div
      v-if="
        store.connection !== 'online' &&
        (store.phase === 'lobby' || store.phase === 'starting' || store.phase === 'connecting')
      "
      class="alert py-2"
      :class="store.connection === 'failed' ? 'alert-error' : 'alert-warning'"
    >
      <span
        v-if="store.connection === 'reconnecting'"
        class="loading loading-spinner loading-sm"
      ></span>
      <span class="text-sm font-medium">
        {{
          store.connection === 'failed'
            ? 'Connection lost. The server may be waking up.'
            : 'Reconnecting… your seat is held.'
        }}
      </span>
      <button
        v-if="store.connection === 'failed'"
        class="btn btn-soft btn-sm"
        @click="store.retryNow()"
      >
        Retry now
      </button>
    </div>

    <div v-if="store.error" role="alert" class="alert alert-error py-2 text-sm">
      <span>{{ store.error }}</span>
    </div>

    <!-- closed -->
    <div v-if="store.phase === 'closed'" class="card bg-base-100 shadow-xl">
      <div class="card-body items-center text-center">
        <p class="text-sm opacity-80">{{ store.closedMessage || 'This race has ended.' }}</p>
        <button class="btn btn-soft btn-primary mt-2" @click="leave">Back to setup</button>
      </div>
    </div>

    <!-- lobby -->
    <template v-else-if="store.phase === 'lobby' || store.phase === 'connecting'">
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-black">Hanoi race · {{ store.disks }} disks</h2>
            <span v-if="store.roomCode" class="badge badge-lg badge-primary font-mono">
              {{ store.roomCode }}
            </span>
          </div>
          <p class="text-sm opacity-70">
            {{
              store.isHost
                ? 'Share the code. Start once at least two players are ready.'
                : 'The host starts the race once everyone is ready.'
            }}
          </p>
          <div v-if="store.roomCode" class="flex-items-center flex gap-2">
            <RouterLink
              :to="{ path: '/hanoi', query: { room: store.roomCode } }"
              class="btn btn-soft btn-sm"
            >
              <Icon icon="lucide:link" class="h-4 w-4" />
              Copy join link
            </RouterLink>
          </div>
          <p v-if="needMorePlayers" class="text-xs opacity-60">
            {{ store.players.length }}/2 players — a race needs at least two.
          </p>
        </div>
      </div>

      <LobbyRoster
        :players="store.players"
        :max-players="store.maxPlayers"
        :self-id="store.playerId"
        :is-host="store.isHost"
        @kick="store.kickPlayer"
      />

      <div class="flex flex-wrap gap-2">
        <button
          class="btn flex-1"
          :class="store.myReady ? 'btn-success' : 'btn-soft btn-primary'"
          @click="store.toggleReady(!store.myReady)"
        >
          {{ store.myReady ? 'Ready!' : 'Tap when ready' }}
        </button>
        <button
          v-if="store.isHost"
          class="btn btn-soft btn-primary"
          :disabled="!canStart"
          @click="store.startRace()"
        >
          <Icon icon="lucide:play" class="h-4 w-4" />
          Start race
        </button>
        <button class="btn btn-ghost" @click="leave">Leave</button>
      </div>

      <div class="rounded-2xl bg-base-200/60 p-4">
        <h3 class="text-sm font-bold tracking-wider uppercase opacity-70">Lobby chat</h3>
        <div v-if="store.chatMessages.length" class="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
          <p v-for="m in store.chatMessages" :key="m.id" class="text-sm break-words">
            <span class="font-semibold">{{ m.name }}:</span>
            <span class="opacity-80"> {{ m.text }}</span>
          </p>
        </div>
        <p v-else class="mt-1 text-sm opacity-50">No messages yet — say hi.</p>
        <form class="mt-2 flex gap-2" @submit.prevent="send">
          <input
            v-model="draft"
            type="text"
            maxlength="200"
            placeholder="Message the lobby…"
            class="input input-bordered input-sm flex-1"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-soft btn-primary btn-sm" :disabled="!draft.trim()">
            Send
          </button>
        </form>
      </div>
    </template>

    <!-- countdown -->
    <CountdownOverlay
      v-else-if="store.phase === 'starting'"
      :deadline="store.startingDeadline"
      :cancellable="store.isHost"
      @cancel="store.cancelStart()"
    />

    <!-- racing -->
    <template v-else-if="store.phase === 'racing'">
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-black">Hanoi race · {{ store.disks }} disks</h2>
            <span v-if="store.isHost" class="badge badge-secondary badge-sm">Host</span>
          </div>
          <p v-if="store.myStatus === 'finished'" class="text-sm font-semibold text-success">
            You finished — waiting for the others.
          </p>
          <p v-else-if="store.myStatus === 'dnf'" class="text-sm font-semibold opacity-70">
            You're out of this race.
          </p>
          <div v-else class="flex items-center gap-2">
            <button class="btn btn-soft btn-error btn-sm" @click="store.resign()">Resign</button>
            <button v-if="store.isHost" class="btn btn-soft btn-sm" @click="store.endRace()">
              End race
            </button>
          </div>
        </div>
      </div>

      <div class="rounded-2xl bg-base-200/60 p-3 text-sm">
        <p class="font-semibold">Finished ({{ finished.length }}/{{ store.standings.length }})</p>
        <ul v-if="finished.length" class="mt-1 space-y-0.5">
          <li v-for="e in finished" :key="e.playerId" class="flex justify-between gap-2">
            <span
              ><span class="badge badge-xs badge-primary mr-1">{{ e.rank }}</span
              >{{ e.name }}</span
            >
            <span class="tabular-nums opacity-70">{{ formatDuration(e.elapsedMs) }}</span>
          </li>
        </ul>
        <p v-else class="mt-1 opacity-50">No one has finished yet.</p>
        <p v-if="stillRacing.length" class="mt-2 text-xs opacity-60">
          Still racing: {{ stillRacing.map((e) => e.name).join(', ') }}
        </p>
      </div>

      <HanoiScreen
        v-if="store.myStatus !== 'finished' && store.myStatus !== 'dnf'"
        :key="store.startedAt"
        :disks="store.disks"
        @solved="onSolved"
      />
    </template>

    <!-- finished -->
    <template v-else-if="store.phase === 'finished'">
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body gap-3">
          <h2 class="text-lg font-black">Race results</h2>
          <ul class="space-y-1">
            <li
              v-for="e in store.standings"
              :key="e.playerId"
              class="flex items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2"
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="badge badge-sm"
                  :class="e.rank === 1 ? 'badge-primary' : 'badge-ghost'"
                >
                  {{ e.rank }}
                </span>
                <span class="truncate font-semibold">{{ e.name }}</span>
                <span
                  v-if="store.playerId && e.playerId === store.playerId"
                  class="badge badge-xs badge-primary"
                  >you</span
                >
              </span>
              <span class="shrink-0 text-right text-sm">
                <template v-if="e.status === 'finished'">
                  <span class="tabular-nums">{{ formatDuration(e.elapsedMs) }}</span>
                  <span class="ml-2 opacity-60">{{ e.moves }} moves</span>
                </template>
                <span v-else class="opacity-60">{{ statusLabel(e.status) }}</span>
              </span>
            </li>
          </ul>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="store.isHost"
              class="btn btn-soft btn-primary"
              @click="store.backToLobby()"
            >
              <Icon icon="lucide:rotate-ccw" class="h-4 w-4" />
              Back to lobby
            </button>
            <button class="btn btn-ghost" @click="leave">Leave</button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
