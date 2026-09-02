<script lang="ts" setup>
import { computed, ref } from 'vue'
import { roomServerOrigin, useGroupStore } from '../stores/groupStore'
import { useCountdown } from '../composables/useCountdown'
import SettingsMenu from './SettingsMenu.vue'

const emit = defineEmits<{ leave: [] }>()

const store = useGroupStore()
const countdown = useCountdown(() => store.deadline)

const copied = ref(false)

const answeredCount = computed(() => Object.keys(store.liveAnswers).length)
const isLastQuestion = computed(() => store.currentIndex + 1 >= store.total)
const canAdvance = computed(() => countdown.expired.value || answeredCount.value > 0)

const correctAnswer = computed(() => store.hostQuestions[store.currentIndex]?.correct_answer ?? '')

function optionCount(option: string) {
  return Object.values(store.liveAnswers).filter((a) => a.option === option).length
}

function formatTime(ms: number) {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`
}

function optionBarClass(option: string) {
  if (!countdown.expired.value) {
    return 'bg-base-200 text-base-content'
  }
  if (option === correctAnswer.value) {
    return 'bg-success/15 text-success border-success/30'
  }
  if (Object.values(store.liveAnswers).some((a) => a.option === option && !a.correct)) {
    return 'bg-error/10 text-error border-error/30'
  }
  return 'bg-base-200 text-base-content'
}

let resolvedLanHost: string | null = null

async function resolveLanHost() {
  if (resolvedLanHost) {
    return resolvedLanHost
  }
  try {
    const response = await fetch(`${roomServerOrigin()}/lan`, {
      signal: AbortSignal.timeout(2000),
    })
    const data = (await response.json()) as { addresses: string[] }
    resolvedLanHost = data.addresses[0] ?? null
  } catch {
    resolvedLanHost = null
  }
  return resolvedLanHost
}

// on localhost the copied link must carry the LAN address so phones can open it
async function joinLink() {
  const hostname = window.location.hostname
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1'
  const host = isLoopback ? ((await resolveLanHost()) ?? hostname) : hostname
  const port = window.location.port ? `:${window.location.port}` : ''
  return `${window.location.protocol}//${host}${port}${window.location.pathname}?room=${store.roomCode}`
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(await joinLink())
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard unavailable — the code itself is shown on screen */
  }
}

function next() {
  store.nextQuestion()
}

function cancel() {
  store.closeRoom()
  emit('leave')
}

function finish() {
  store.closeRoom()
  emit('leave')
}
</script>

<template>
  <div class="min-h-screen bg-base-100 text-base-content">
    <header class="navbar bg-base-200 px-4 py-4 shadow-sm">
      <div class="navbar-start">
        <span class="text-xl font-bold">Quiznix AI</span>
        <span class="badge badge-secondary badge-sm mx-2 hidden sm:inline-flex">Host</span>
      </div>
      <div class="navbar-end">
        <SettingsMenu />
      </div>
    </header>

    <main class="mx-auto w-full max-w-3xl p-4">
      <!-- closed by the host or a lost connection -->
      <div v-if="store.phase === 'closed'" class="card mt-4 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="text-xl font-bold">{{ store.closedMessage }}</h2>
          <button class="btn btn-primary" @click="emit('leave')">Back to home</button>
        </div>
      </div>

      <!-- creating room — replaces the brief idle flash before the server replies -->
      <div v-else-if="store.phase === 'connecting'" class="card mt-4 shadow-xl">
        <div class="card-body items-center gap-3 text-center">
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <h2 class="text-lg font-bold">Creating room…</h2>
          <p class="text-sm opacity-70">Contacting the room server.</p>
        </div>
      </div>

      <!-- room creation failed (e.g. server unreachable) -->
      <div v-else-if="store.phase === 'idle'" class="card mt-4 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="text-xl font-bold">Could not create the room</h2>
          <p v-if="store.error" class="text-sm opacity-70">{{ store.error }}</p>
          <button class="btn btn-primary" @click="emit('leave')">Back to home</button>
        </div>
      </div>

      <!-- final leaderboard -->
      <div v-else-if="store.phase === 'finished'" class="card mt-4 shadow-xl">
        <div class="card-body">
          <h2 class="text-center text-2xl font-black">🏆 Final scores</h2>
          <p class="text-center font-medium opacity-70">{{ store.topic }}</p>
          <ul class="mt-4 grid gap-2">
            <li
              v-for="(entry, index) in store.leaderboard"
              :key="entry.name + index"
              class="flex items-center gap-3 rounded-xl border p-4"
              :class="index === 0 ? 'border-success bg-success/5' : 'border-base-300'"
            >
              <span
                class="flex h-8 w-8 items-center justify-center rounded-full font-black"
                :class="
                  index === 0 ? 'bg-success text-success-content' : 'bg-base-300 text-base-content'
                "
              >
                {{ index + 1 }}
              </span>
              <span class="font-bold">{{ entry.name }}</span>
              <span class="ml-auto text-right">
                <span class="block font-black">{{ (entry.score / 1000).toFixed(1) }} pts</span>
                <span class="block text-xs opacity-60">
                  {{ entry.correct }}/{{ entry.total }} correct ·
                  {{ formatTime(entry.timeSpentMs) }}
                </span>
              </span>
            </li>
          </ul>
          <button class="btn btn-primary mt-4" @click="finish">End game</button>
        </div>
      </div>

      <!-- lobby: show the room code and wait for players -->
      <div v-else-if="store.phase === 'lobby'" class="card mt-4 shadow-xl">
        <div class="card-body items-center gap-4 text-center">
          <div>
            <span class="label text-base font-semibold opacity-70">Room code</span>
            <div class="text-5xl font-black tracking-[0.35em]">{{ store.roomCode }}</div>
          </div>
          <p class="max-w-md text-sm opacity-70">
            Players open Quiznix AI on their gadgets, enter this code and their name to join.
          </p>
          <button class="btn btn-outline btn-sm" @click="copyLink">
            {{ copied ? 'Copied!' : 'Copy join link' }}
          </button>
          <div class="flex min-h-10 flex-wrap justify-center gap-2">
            <span
              v-for="player in store.players"
              :key="player.playerId"
              class="badge badge-soft badge-secondary"
            >
              👤 {{ player.name }}
            </span>
            <span v-if="store.players.length === 0" class="text-sm opacity-60">
              Waiting for players…
            </span>
          </div>
          <p class="text-sm opacity-60">
            {{ store.players.length }} / {{ store.maxPlayers }} joined
          </p>
          <div class="card-actions mt-2">
            <button
              class="btn btn-primary btn-lg"
              :disabled="store.players.length === 0"
              @click="store.startGame()"
            >
              🚀 Start game
            </button>
            <button class="btn btn-ghost" @click="cancel">Cancel</button>
          </div>
        </div>
      </div>

      <!-- live question -->
      <div v-else-if="store.phase === 'question'" class="card mt-4 shadow-xl">
        <div class="card-body gap-4">
          <div class="flex items-center justify-between">
            <span class="font-bold">Question {{ store.currentIndex + 1 }} / {{ store.total }}</span>
            <span
              class="badge badge-lg"
              :class="countdown.expired.value ? 'badge-error' : 'badge-primary'"
            >
              {{ countdown.expired.value ? 'time up' : `${countdown.remaining.value}s` }}
            </span>
          </div>
          <progress
            class="progress progress-primary"
            :value="store.currentIndex + 1"
            :max="store.total"
          />
          <h2 class="text-2xl font-bold">{{ store.question }}</h2>
          <p class="text-sm opacity-70">
            {{ answeredCount }} / {{ store.players.length }} answered
          </p>
          <div class="grid gap-2">
            <div
              v-for="option in store.options"
              :key="option"
              class="flex items-center justify-between rounded-xl border p-4"
              :class="optionBarClass(option)"
            >
              <span>{{ option }}</span>
              <span class="font-black">{{ optionCount(option) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <span v-if="!canAdvance" class="text-sm opacity-60">Waiting for answers…</span>
            <button class="btn btn-primary ml-auto" :disabled="!canAdvance" @click="next">
              {{ isLastQuestion ? 'See results' : 'Next question' }}
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
