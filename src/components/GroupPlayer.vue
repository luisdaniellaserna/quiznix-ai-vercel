<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue'
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

const selectedOption = ref<string | null>(null)
const hasSubmitted = computed(() => store.myAnswer !== null)
const isRevealed = computed(() => hasSubmitted.value || countdown.expired.value)

function formatTime(ms: number) {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`
}

function selectOption(option: string) {
  if (countdown.expired.value || hasSubmitted.value) return
  selectedOption.value = option
}

function submitAnswer() {
  if (!selectedOption.value || hasSubmitted.value || countdown.expired.value) return
  store.submitAnswer(selectedOption.value)
}

// clear selection when a new question starts
watch(
  () => store.currentIndex,
  () => {
    selectedOption.value = null
  },
)
watch(
  () => store.question,
  () => {
    if (store.phase === 'question') selectedOption.value = null
  },
)
watch(
  () => store.myAnswer,
  (val) => {
    if (val === null) selectedOption.value = null
  },
)

const closedDialogRef = ref<HTMLDialogElement | null>(null)

watch(
  () => store.phase,
  (phase) => {
    if (phase === 'closed') {
      void nextTick(() => {
        if (!closedDialogRef.value?.open) closedDialogRef.value?.showModal()
      })
    } else {
      closedDialogRef.value?.close()
    }
  },
  { immediate: true },
)

watch(
  () => store.closedMessage,
  () => {
    if (store.phase === 'closed') {
      void nextTick(() => {
        if (!closedDialogRef.value?.open) closedDialogRef.value?.showModal()
      })
    }
  },
)

function done() {
  closedDialogRef.value?.close()
  store.leave()
  emit('leave')
}
</script>

<template>
  <div class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
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
      <!-- closed by the host or a lost connection — also shown as modal -->
      <div v-if="store.phase === 'closed'" class="card mt-4 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="text-xl font-bold">{{ store.closedMessage }}</h2>
          <button class="btn btn-primary" @click="done">Back to home</button>
        </div>
      </div>

      <!-- joining — prevents flash of the join form/host code after tapping Join -->
      <div v-else-if="store.phase === 'connecting'" class="card mt-4 shadow-xl">
        <div class="card-body items-center gap-3 text-center">
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <h2 class="text-lg font-bold">Joining room…</h2>
          <p class="text-sm opacity-70">
            Connecting as {{ store.playerName || playerName || 'player' }} — please wait.
          </p>
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
              class="input input-bordered input-lg w-full rounded-xl text-center text-xl font-black tracking-[0.2em] uppercase focus:outline-none sm:text-2xl sm:tracking-[0.3em]"
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
          <h2 class="break-words text-xl font-bold sm:text-2xl">{{ store.question }}</h2>
          <div class="grid gap-3">
            <button
              v-for="option in shuffledOptions"
              :key="option"
              class="btn btn-lg h-auto min-h-12 justify-start whitespace-normal break-words py-3 text-left rounded-xl"
              :class="{
                'btn-success': isRevealed && option === store.correctAnswer,
                'btn-error': isRevealed && option === store.myAnswer && option !== store.correctAnswer,
                'btn-primary': !isRevealed && (selectedOption === option || store.myAnswer === option),
                'btn-outline': !isRevealed && selectedOption !== option && store.myAnswer !== option,
                'opacity-60': isRevealed && option !== store.correctAnswer && option !== store.myAnswer,
              }"
              :disabled="countdown.expired.value || hasSubmitted"
              @click="selectOption(option)"
            >
              {{ option }}
            </button>
          </div>
          <button
            class="btn btn-primary btn-lg w-full"
            :disabled="!selectedOption || hasSubmitted || countdown.expired.value"
            @click="submitAnswer"
          >
            {{ hasSubmitted ? 'Submitted ✓' : countdown.expired.value ? 'Time up' : 'Submit answer' }}
          </button>

          <!-- highlight correct answer immediately after submit (and on time up) -->
          <div v-if="isRevealed && store.correctAnswer" class="alert justify-center gap-2" :class="store.myAnswer === store.correctAnswer ? 'alert-success' : 'alert-error'">
            <span v-if="store.myAnswer === store.correctAnswer">Correct! Answer: <strong>{{ store.correctAnswer }}</strong></span>
            <span v-else>Correct answer: <strong>{{ store.correctAnswer }}</strong></span>
            <span class="text-xs opacity-70">{{ countdown.expired.value ? 'Next in a few seconds…' : 'Waiting for others…' }}</span>
          </div>

          <p class="text-center text-sm opacity-70">
            {{
              countdown.expired.value
                ? hasSubmitted
                  ? 'Time is up! Answer locked.'
                  : 'Time is up — no answer.'
                : hasSubmitted
                  ? 'Answer submitted and locked. Waiting for others…'
                  : selectedOption
                    ? 'Tap Submit to lock your answer.'
                    : 'Select an answer, then tap Submit to lock it.'
            }}
          </p>
        </div>
      </div>
    </main>

    <!-- host-ended modal -->
    <dialog ref="closedDialogRef" class="modal">
      <div class="modal-box text-center">
        <h3 class="text-lg font-bold">Quiz has ended by the host</h3>
        <p class="py-4 text-sm opacity-80">{{ store.closedMessage || 'The host ended the quiz.' }}</p>
        <div class="modal-action justify-center">
          <button class="btn btn-primary" @click="done">Back to home</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
