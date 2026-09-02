<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { useGroupStore } from '../stores/groupStore'
import { useCountdown } from '../composables/useCountdown'
import SettingsMenu from './SettingsMenu.vue'

const emit = defineEmits<{ leave: [] }>()

const store = useGroupStore()
const countdown = useCountdown(() => store.deadline)

const params = new URLSearchParams(window.location.search)
const joinCode = ref((params.get('room') ?? '').toUpperCase().slice(0, 6))
const playerName = ref('')
const joining = ref(false)

watch(
  () => store.phase,
  (phase) => {
    if (phase === 'lobby' || phase === 'closed') {
      joining.value = false
    }
  },
)

watch(
  () => store.error,
  () => {
    joining.value = false
  },
)

const canJoin = computed(() => joinCode.value.trim().length === 6 && playerName.value.trim() !== '')

function join() {
  if (!canJoin.value) {
    return
  }
  joining.value = true
  store.joinRoom(joinCode.value, playerName.value.trim())
}

const shuffledOptions = computed(() => [...store.options].sort(() => Math.random() - 0.5))

function formatTime(ms: number) {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`
}

function pick(option: string) {
  if (!countdown.expired.value) {
    store.submitAnswer(option)
  }
}

function done() {
  store.leave()
  emit('leave')
}
</script>

<template>
  <div class="min-h-screen bg-base-100 text-base-content">
    <header class="navbar bg-base-200 px-4 py-4 shadow-sm">
      <div class="navbar-start">
        <span class="text-xl font-bold">Quiznix AI</span>
        <span v-if="store.roomCode" class="badge badge-soft badge-primary badge-sm mx-2">
          Room {{ store.roomCode }}
        </span>
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
          <button class="btn btn-primary" @click="done">Back to home</button>
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
              :class="
                entry.name === store.playerName
                  ? 'border-primary bg-primary/5'
                  : index === 0
                    ? 'border-success bg-success/5'
                    : 'border-base-300'
              "
            >
              <span
                class="flex h-8 w-8 items-center justify-center rounded-full font-black"
                :class="
                  index === 0 ? 'bg-success text-success-content' : 'bg-base-300 text-base-content'
                "
              >
                {{ index + 1 }}
              </span>
              <span class="font-bold">
                {{ entry.name }}
                <span v-if="entry.name === store.playerName" class="badge badge-primary badge-sm"
                  >you</span
                >
              </span>
              <span class="ml-auto text-right">
                <span class="block font-black">{{ (entry.score / 1000).toFixed(1) }} pts</span>
                <span class="block text-xs opacity-60">
                  {{ entry.correct }}/{{ entry.total }} correct ·
                  {{ formatTime(entry.timeSpentMs) }}
                </span>
              </span>
            </li>
          </ul>
          <button class="btn btn-primary mt-4" @click="done">Done</button>
        </div>
      </div>

      <!-- join form -->
      <div v-else-if="store.phase === 'idle'" class="card mt-4 shadow-xl">
        <div class="card-body gap-4">
          <div class="text-center">
            <h2 class="text-2xl font-black">Join a live quiz</h2>
            <p class="text-sm opacity-70">Enter the room code your host shared.</p>
          </div>
          <div v-if="store.error" role="alert" class="alert alert-error">
            {{ store.error }}
          </div>
          <label class="form-control">
            <span class="label font-semibold">Room code</span>
            <input
              v-model="joinCode"
              type="text"
              maxlength="6"
              placeholder="ABC123"
              class="input input-bordered input-lg w-full rounded-xl text-center text-2xl font-black tracking-[0.3em] uppercase focus:outline-none"
              @input="
                (event) => (joinCode = (event.target as HTMLInputElement).value.toUpperCase())
              "
            />
          </label>
          <label class="form-control">
            <span class="label font-semibold">Your name</span>
            <input
              v-model="playerName"
              type="text"
              maxlength="24"
              placeholder="e.g. Ana"
              class="input input-bordered input-lg w-full rounded-xl focus:outline-none"
            />
          </label>
          <button class="btn btn-primary btn-lg" :disabled="!canJoin || joining" @click="join">
            {{ joining ? 'Joining…' : 'Join game' }}
          </button>
        </div>
      </div>

      <!-- lobby: waiting for the host -->
      <div v-else-if="store.phase === 'lobby'" class="card mt-4 shadow-xl">
        <div class="card-body items-center gap-4 text-center">
          <h2 class="text-2xl font-black">You're in!</h2>
          <p class="text-sm opacity-70">Waiting for the host to start the game…</p>
          <div class="flex flex-wrap justify-center gap-2">
            <span
              v-for="player in store.players"
              :key="player.playerId"
              class="badge badge-soft badge-secondary"
            >
              👤 {{ player.name }}
            </span>
          </div>
          <button class="btn btn-ghost" @click="done">Leave lobby</button>
        </div>
      </div>

      <!-- answering a question -->
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
          <div class="grid gap-3">
            <button
              v-for="option in shuffledOptions"
              :key="option"
              class="btn btn-lg justify-start rounded-xl"
              :class="store.myAnswer === option ? 'btn-primary' : 'btn-outline'"
              :disabled="countdown.expired.value"
              @click="pick(option)"
            >
              {{ option }}
            </button>
          </div>
          <p class="text-center text-sm opacity-70">
            {{
              countdown.expired.value
                ? store.myAnswer
                  ? 'Time is up!'
                  : 'Time is up — no answer.'
                : store.myAnswer
                  ? 'Answer saved. You can change it until the clock runs out.'
                  : 'Tap an answer before the clock runs out.'
            }}
          </p>
        </div>
      </div>
    </main>
  </div>
</template>
