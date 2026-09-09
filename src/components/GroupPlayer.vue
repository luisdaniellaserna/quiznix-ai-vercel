<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useGroupStore } from '../stores/groupStore'
import { useCountdown } from '../composables/useCountdown'
import SettingsMenu from './SettingsMenu.vue'
import ConfettiBurst from './ConfettiBurst.vue'
import FinalLeaderboard from './FinalLeaderboard.vue'
import LobbyChat from './LobbyChat.vue'
import ConnectionBanner from './ConnectionBanner.vue'
import LobbyRoster from './LobbyRoster.vue'
import LobbyStatusBanner from './LobbyStatusBanner.vue'
import CountdownOverlay from './CountdownOverlay.vue'
import TriviaCard from './TriviaCard.vue'

const emit = defineEmits<{
  leave: []
  'room-conflict': [
    payload: {
      blocker: {
        tabId: string
        code: string
        role: 'host' | 'player'
        playerName?: string
        ageMs: number
      }
      code: string
      name: string
    },
  ]
}>()

const store = useGroupStore()
const countdown = useCountdown(() => store.deadline)

const params = new URLSearchParams(window.location.search)
const joinCode = ref((params.get('room') ?? '').toUpperCase().slice(0, 6))
const playerName = ref('')
const joining = ref(false)
const resumeOffer = ref(store.getResumeOffer())

function resume() {
  const offer = resumeOffer.value
  if (!offer) return
  const blocker = store.checkRoomConflict()
  if (blocker && blocker.code !== offer.code) {
    emit('room-conflict', { blocker, code: offer.code, name: offer.name })
    return
  }
  joining.value = true
  joinCode.value = offer.code
  playerName.value = offer.name
  store.resumePlayer(offer.code, offer.name)
}

function dismissResume() {
  const offer = resumeOffer.value
  if (offer) store.discardResume(offer.code)
  resumeOffer.value = null
}

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
  (message) => {
    joining.value = false
    // a dead seat (room restarted, window expired, seat taken) invalidates the offer
    if (
      message &&
      resumeOffer.value &&
      /not found|expired|verify|no pending slot|full/i.test(message)
    ) {
      store.discardResume(resumeOffer.value.code)
      resumeOffer.value = null
    }
  },
)

const canJoin = computed(() => joinCode.value.trim().length === 6 && playerName.value.trim() !== '')

function join() {
  if (!canJoin.value) {
    return
  }
  // if the user is changing to a different room than the one this tab already
  // claims, surface the cross-tab conflict modal in App.vue via the request event
  const blocker = store.checkRoomConflict()
  const targetCode = joinCode.value.trim().toUpperCase()
  if (blocker && blocker.code !== targetCode) {
    emit('room-conflict', { blocker, code: targetCode, name: playerName.value.trim() })
    return
  }
  joining.value = true
  store.joinRoom(targetCode, playerName.value.trim())
}

const shuffledOptions = computed(() => [...store.options].sort(() => Math.random() - 0.5))

const selectedOption = ref<string | null>(null)
const hasSubmitted = computed(() => store.myAnswer !== null)
// Correct answer only shows when the whole cohort has answered, the timer ran out,
// or the host force-skipped (server emits all-answered with the correct answer first).
const isRevealed = computed(() => store.allAnswered || countdown.expired.value)

// Sidebar stats — derive from store so they refresh automatically as messages arrive.
const totalRoster = computed(() => store.players.length)
const answeredDisplay = computed(() =>
  store.answeredCount > 0 ? store.answeredCount : hasSubmitted.value ? 1 : 0,
)
const totalDisplay = computed(() =>
  store.totalPlayers > 0 ? store.totalPlayers : totalRoster.value,
)

const ORDINAL_SUFFIX = ['th', 'st', 'nd', 'rd']
function ordinal(rank: number): string {
  const mod100 = rank % 100
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`
  const mod10 = rank % 10
  return `${rank}${ORDINAL_SUFFIX[mod10] ?? 'th'}`
}
const rankLabel = computed(() => ordinal(store.myRank))
const myScoreLine = computed(() => {
  const me = store.scoreboard.find((e) => e.playerId === store.playerId)
  if (!me) return ''
  return `${(me.score / 1000).toFixed(1)} pts · ${me.correct} correct so far`
})

const isWinner = computed(() => {
  const board = store.leaderboard
  return !!board?.length && board[0].name === store.playerName
})

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

const exitDialogRef = ref<HTMLDialogElement | null>(null)

function requestLeave() {
  exitDialogRef.value?.showModal()
}

function confirmLeave() {
  exitDialogRef.value?.close()
  done()
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

    <main class="mx-auto w-full max-w-5xl p-4">
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
        <ConfettiBurst v-if="isWinner" />
        <div class="card-body">
          <h2 class="text-center text-2xl font-black">🏆 Final scores</h2>
          <p class="text-center font-medium opacity-70">{{ store.topic }}</p>
          <FinalLeaderboard :entries="store.leaderboard ?? []" :highlight-name="store.playerName" />
          <div class="mt-4 grid gap-2">
            <button class="btn btn-outline w-full" @click="store.returnToLobby()">
              Back to lobby
            </button>
            <button class="btn btn-primary w-full" @click="done">Done</button>
          </div>
        </div>
      </div>

      <!-- join form -->
      <div v-else-if="store.phase === 'idle'" class="card mt-4 shadow-xl">
        <div class="card-body gap-4">
          <div class="text-center">
            <h2 class="text-2xl font-black">Join a live quiz</h2>
            <p class="text-sm opacity-70">Enter the room code your host shared.</p>
          </div>
          <div v-if="resumeOffer && resumeOffer.role === 'player'" class="alert alert-info text-sm">
            <span
              >Were you <strong>{{ resumeOffer.name }}</strong> in room
              <strong>{{ resumeOffer.code }}</strong
              >? Your seat may still be held.</span
            >
            <div class="flex gap-2">
              <button class="btn btn-primary btn-sm" @click="resume">Resume</button>
              <button class="btn btn-ghost btn-sm" @click="dismissResume">Dismiss</button>
            </div>
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
      <div
        v-else-if="store.phase === 'lobby'"
        class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start"
      >
        <div class="card flex-1 shadow-xl">
          <div class="card-body items-center gap-4 text-center">
            <h2 class="text-2xl font-black">You're in!</h2>
            <div class="w-full">
              <ConnectionBanner />
            </div>
            <div class="w-full">
              <LobbyStatusBanner
                :status="store.hostStatus"
                :detail="store.hostDetail"
                :topic="store.topic"
                :quiz-ready="store.quizReady"
                :host-online="store.hostOnline"
                :host-offline-expires-at="store.hostOfflineExpiresAt"
              />
            </div>
            <p v-if="store.error" role="alert" class="alert alert-error text-sm">
              {{ store.error }}
            </p>
            <button
              class="btn btn-lg w-full"
              :class="store.myReady ? 'btn-success' : 'btn-primary'"
              :disabled="!store.quizReady"
              @click="store.toggleReady(!store.myReady)"
            >
              {{ store.myReady ? '✓ Ready — tap to unready' : "I'm Ready" }}
            </button>
            <p class="text-sm opacity-70">
              {{ store.readyCount }} / {{ store.players.length }} ready · host starts when 100%
              ready
            </p>
            <div class="w-full text-left">
              <LobbyChat />
            </div>
            <TriviaCard :interval-ms="10000" />
            <button class="btn btn-error btn-outline" @click="requestLeave">Leave lobby</button>
          </div>
        </div>
        <aside class="w-full lg:w-80 lg:shrink-0">
          <LobbyRoster
            :players="store.players"
            :max-players="store.maxPlayers"
            :self-id="store.playerId"
            :is-host="false"
          />
        </aside>
      </div>

      <!-- starting countdown -->
      <div
        v-else-if="store.phase === 'starting'"
        class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start"
      >
        <div class="card flex-1 shadow-xl">
          <div class="card-body items-center gap-4 text-center">
            <div class="w-full">
              <ConnectionBanner />
            </div>
            <div class="w-full">
              <LobbyStatusBanner
                status="countdown"
                :detail="''"
                :topic="store.topic"
                :quiz-ready="store.quizReady"
                :host-online="store.hostOnline"
                :host-offline-expires-at="store.hostOfflineExpiresAt"
              />
            </div>
            <p class="text-sm opacity-70">
              Starting in
              {{ Math.ceil(((store.startingDeadline ?? Date.now()) - Date.now()) / 1000) }}s — stay
              ready…
            </p>
            <div class="w-full text-left">
              <LobbyChat />
            </div>
          </div>
        </div>
        <aside class="w-full lg:w-80 lg:shrink-0">
          <LobbyRoster
            :players="store.players"
            :max-players="store.maxPlayers"
            :self-id="store.playerId"
            :is-host="false"
          />
        </aside>
        <CountdownOverlay :deadline="store.startingDeadline" />
      </div>

      <!-- answering a question -->
      <div
        v-else-if="store.phase === 'question'"
        class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start"
      >
        <div class="card flex-1 shadow-xl">
          <div class="card-body gap-4">
            <ConnectionBanner />
            <div class="flex items-center justify-between">
              <span class="font-bold"
                >Question {{ store.currentIndex + 1 }} / {{ store.total }}</span
              >
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
                  'btn-error':
                    isRevealed && option === store.myAnswer && option !== store.correctAnswer,
                  'btn-primary':
                    !isRevealed && (selectedOption === option || store.myAnswer === option),
                  'btn-active':
                    !isRevealed && (selectedOption === option || store.myAnswer === option),
                  'btn-outline':
                    !isRevealed && selectedOption !== option && store.myAnswer !== option,
                  'opacity-60':
                    isRevealed && option !== store.correctAnswer && option !== store.myAnswer,
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
              {{
                hasSubmitted ? 'Submitted ✓' : countdown.expired.value ? 'Time up' : 'Submit answer'
              }}
            </button>

            <!-- reveal is gated on all-answered / timer expired / host force-skip -->
            <div
              v-if="isRevealed && store.correctAnswer"
              class="alert justify-center gap-2"
              :class="store.myAnswer === store.correctAnswer ? 'alert-success' : 'alert-error'"
            >
              <span v-if="store.myAnswer === store.correctAnswer"
                >Correct! Answer: <strong>{{ store.correctAnswer }}</strong></span
              >
              <span v-else-if="hasSubmitted"
                >Not quite. Correct answer: <strong>{{ store.correctAnswer }}</strong></span
              >
              <span v-else
                >Correct answer: <strong>{{ store.correctAnswer }}</strong></span
              >
              <span class="text-xs opacity-70">
                {{
                  countdown.expired.value
                    ? 'Time is up — next in a few seconds…'
                    : store.allAnswered
                      ? 'All answers in — next question in a moment…'
                      : 'Waiting for others…'
                }}
              </span>
            </div>

            <p class="text-center text-sm opacity-70">
              {{
                countdown.expired.value
                  ? hasSubmitted
                    ? 'Time is up! Answer locked.'
                    : 'Time is up — no answer.'
                  : hasSubmitted
                    ? store.allAnswered
                      ? 'All answered — revealing correct answer.'
                      : 'Answer submitted and locked. Waiting for others…'
                    : selectedOption
                      ? 'Tap Submit to lock your answer.'
                      : 'Select an answer, then tap Submit to lock it.'
              }}
            </p>
          </div>
        </div>

        <!-- live progress sidebar -->
        <aside class="flex w-full flex-col gap-3 lg:sticky lg:top-4 lg:w-64 lg:shrink-0">
          <div class="card shadow-xl">
            <div class="card-body gap-1 p-4">
              <p class="text-xs font-semibold uppercase tracking-wider opacity-60">Answered</p>
              <p class="text-2xl font-black">
                {{ answeredDisplay }}<span class="opacity-50">/{{ totalDisplay }}</span>
              </p>
              <progress
                class="progress progress-primary mt-1 h-2"
                :value="answeredDisplay"
                :max="totalDisplay || 1"
              />
              <p class="text-xs opacity-70">
                {{
                  store.allAnswered
                    ? 'Everyone has answered!'
                    : countdown.expired.value
                      ? 'Time is up — locking in…'
                      : 'Live count of players who locked in.'
                }}
              </p>
            </div>
          </div>

          <div class="card shadow-xl">
            <div class="card-body gap-1 p-4">
              <p class="text-xs font-semibold uppercase tracking-wider opacity-60">Current rank</p>
              <p class="text-2xl font-black">
                <template v-if="store.myRank > 0">
                  <span class="text-primary">{{ rankLabel }}</span
                  ><span class="opacity-50">/{{ totalRoster }}</span>
                </template>
                <template v-else>
                  <span class="opacity-50">—</span>
                </template>
              </p>
              <p class="text-xs opacity-70">
                <template v-if="store.myRank > 0">
                  {{ myScoreLine }}
                </template>
                <template v-else> Ranking will appear after the first question. </template>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <!-- leave-lobby verification -->
    <dialog ref="exitDialogRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Leave the lobby?</h3>
        <p class="py-4 text-sm opacity-80">
          You'll leave Room {{ store.roomCode || 'PENDING' }} and need the room code to rejoin. Are
          you sure you want to exit the lobby?
        </p>
        <div class="modal-action">
          <button class="btn btn-ghost" @click="exitDialogRef?.close()">Stay</button>
          <button class="btn btn-error" @click="confirmLeave">Leave lobby</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>

    <!-- host-ended modal -->
    <dialog ref="closedDialogRef" class="modal">
      <div class="modal-box text-center">
        <h3 class="text-lg font-bold">Quiz has ended by the host</h3>
        <p class="py-4 text-sm opacity-80">
          {{ store.closedMessage || 'The host ended the quiz.' }}
        </p>
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
