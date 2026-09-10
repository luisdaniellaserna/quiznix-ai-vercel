<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { roomServerOrigin, useGroupStore } from '../stores/groupStore'
import { useCountdown } from '../composables/useCountdown'
import SettingsMenu from './SettingsMenu.vue'
import ConfettiBurst from './ConfettiBurst.vue'
import FinalLeaderboard from './FinalLeaderboard.vue'
import LobbyChat from './LobbyChat.vue'
import ConnectionBanner from './ConnectionBanner.vue'
import LobbyRoster from './LobbyRoster.vue'
import CountdownOverlay from './CountdownOverlay.vue'
import TriviaCard from './TriviaCard.vue'

const emit = defineEmits<{ leave: []; 'play-again': []; 'edit-setup': [] }>()

const store = useGroupStore()
const countdown = useCountdown(() => store.deadline)

const copied = ref(false)
const kickTarget = ref<{ playerId: string; name: string } | null>(null)
const kickDialogRef = ref<HTMLDialogElement | null>(null)
const qrDialogRef = ref<HTMLDialogElement | null>(null)
const joinUrl = ref('')

const answeredCount = computed(() => Object.keys(store.liveAnswers).length)
const isLastQuestion = computed(() => store.currentIndex + 1 >= store.total)
const allAnswered = computed(
  () => store.players.length > 0 && answeredCount.value >= store.players.length,
)
const canAdvance = computed(
  () => countdown.expired.value || allAnswered.value || answeredCount.value > 0,
)

// no dead air: when everyone submitted, show correct answer 4s then auto-advance
watch(allAnswered, (done) => {
  if (done && store.phase === 'question' && !countdown.expired.value) {
    window.setTimeout(() => {
      if (store.phase === 'question' && allAnswered.value && !countdown.expired.value) {
        store.nextQuestion()
      }
    }, 4000)
  }
})

// when timer runs out, also reveal correct answer 4s then auto-advance
watch(
  () => countdown.expired.value,
  (expired) => {
    if (expired && store.phase === 'question') {
      window.setTimeout(() => {
        if (store.phase === 'question' && countdown.expired.value) {
          store.nextQuestion()
        }
      }, 4000)
    }
  },
)

const correctAnswer = computed(
  () => store.correctAnswer || store.hostQuestions[store.currentIndex]?.correct_answer || '',
)
const hasWakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator

// keep host screen awake during lobby/question so phone sleep doesn't kill the WS
interface ScreenWakeLock {
  release: () => Promise<void>
}
let wakeLock: ScreenWakeLock | null = null
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await (
        navigator as unknown as {
          wakeLock: { request: (t: string) => Promise<ScreenWakeLock> }
        }
      ).wakeLock.request('screen')
    }
  } catch {}
}
function releaseWakeLock() {
  try {
    wakeLock?.release()
  } catch {}
  wakeLock = null
}
watch(
  () => store.phase,
  (phase) => {
    if (phase === 'lobby' || phase === 'starting' || phase === 'question') {
      void requestWakeLock()
    } else {
      releaseWakeLock()
    }
  },
  { immediate: true },
)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible' &&
      (store.phase === 'lobby' || store.phase === 'starting' || store.phase === 'question')
    ) {
      void requestWakeLock()
    }
  })
}
onUnmounted(() => releaseWakeLock())

function optionCount(option: string) {
  return Object.values(store.liveAnswers).filter((a) => a.option === option).length
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

const qrSrc = computed(
  () =>
    `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(joinUrl.value)}`,
)

async function openQr() {
  joinUrl.value = await joinLink()
  qrDialogRef.value?.showModal()
}

function next() {
  store.nextQuestion()
}

function requestKick(playerId: string, name: string) {
  kickTarget.value = { playerId, name }
  kickDialogRef.value?.showModal()
}

function confirmKick() {
  if (kickTarget.value) store.kickPlayer(kickTarget.value.playerId)
  kickTarget.value = null
  kickDialogRef.value?.close()
}

function cancelKick() {
  kickTarget.value = null
  kickDialogRef.value?.close()
}

const exitDialogRef = ref<HTMLDialogElement | null>(null)

function requestExit() {
  exitDialogRef.value?.showModal()
}

function confirmExit() {
  exitDialogRef.value?.close()
  store.closeRoom()
  emit('leave')
}

function finish() {
  store.closeRoom()
  emit('leave')
}

function playAgain() {
  emit('play-again')
}
</script>

<template>
  <div class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
    <header class="navbar bg-base-200 px-4 py-4 shadow-sm">
      <div class="navbar-start">
        <span class="text-xl font-bold">Quiznix AI</span>
        <span class="badge badge-secondary badge-sm mx-2 hidden sm:inline-flex">Host</span>
      </div>
      <div class="navbar-end gap-2">
        <SettingsMenu
          :show-exit="store.phase === 'lobby' || store.phase === 'question'"
          @exit-quiz="requestExit"
        />
      </div>
    </header>

    <main class="mx-auto w-full max-w-6xl p-4">
      <div
        v-if="(store.phase === 'lobby' || store.phase === 'question') && !hasWakeLock"
        class="alert alert-warning mb-4 text-sm"
      >
        <span
          >Keep this tab visible — some phones disconnect when the screen locks. Use Settings
          → Exit quiz only to end.</span
        >
      </div>
      <!-- closed by the host or a lost connection -->
      <div v-if="store.phase === 'closed'" class="card mt-4 shadow-xl">
        <div class="card-body items-center text-center">
          <h2 class="text-xl font-bold">{{ store.closedMessage }}</h2>
          <button class="btn btn-soft btn-primary" @click="emit('leave')">Back to home</button>
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
          <button class="btn btn-soft btn-primary" @click="emit('leave')">Back to home</button>
        </div>
      </div>

      <!-- final leaderboard -->
      <div v-else-if="store.phase === 'finished'" class="card mt-4 shadow-xl">
        <ConfettiBurst />
        <div class="card-body">
          <h2 class="text-center text-2xl font-black">🏆 Final scores</h2>
          <p class="text-center font-medium opacity-70">{{ store.topic }}</p>
          <FinalLeaderboard :entries="store.leaderboard ?? []" />
          <div class="card-actions mt-4 flex-wrap">
            <button class="btn btn-soft btn-primary flex-1" @click="playAgain">Play again</button>
            <button class="btn btn-soft btn-error" @click="finish">End exam</button>
          </div>
        </div>
      </div>

      <!-- lobby: 2-column dashboard — room/chat left, players/controls right -->
      <div v-else-if="store.phase === 'lobby'" class="mt-4 space-y-4">
        <ConnectionBanner />
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div class="card shadow-xl">
            <div class="card-body gap-0 p-0">
              <section
                class="flex flex-col gap-6 p-6 text-left md:flex-row md:items-stretch"
              >
                <div class="flex min-w-0 flex-1 flex-col gap-3">
                  <span class="text-sm font-bold uppercase leading-none tracking-wider opacity-70"
                    >Room code</span
                  >
                  <div
                    class="break-all text-4xl font-black leading-none tracking-[0.2em] sm:text-5xl sm:tracking-[0.3em]"
                  >
                    {{ store.roomCode }}
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-2">
                    <button class="btn btn-soft btn-sm shrink-0" @click="copyLink">
                      <Icon
                        :icon="copied ? 'lucide:check' : 'lucide:copy'"
                        class="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      {{ copied ? 'Copied!' : 'Copy join link' }}
                    </button>
                    <button class="btn btn-soft btn-sm shrink-0" @click="openQr">
                      <Icon icon="lucide:qr-code" class="h-4 w-4 shrink-0" aria-hidden="true" />
                      Show QR code
                    </button>
                  </div>
                </div>
                <div class="divider m-0 md:divider-horizontal"></div>
                <div class="flex w-full flex-col gap-2 md:max-w-60 md:shrink-0">
                  <h3 class="text-sm font-bold uppercase tracking-wider opacity-70">
                    Ready to start
                  </h3>
                  <p v-if="store.players.length === 0" class="text-sm opacity-70">
                    No players yet
                  </p>
                  <p v-else class="text-sm opacity-70">
                    {{ store.readyCount }} of {{ store.players.length }} players ready
                  </p>
                  <p v-if="!store.quizReady" class="alert alert-warning text-sm">
                    Generating questions… Start unlocks when they are ready.
                  </p>
                  <p v-if="store.error" role="alert" class="alert alert-error text-sm">
                    {{ store.error }}
                  </p>
                  <div class="flex flex-col gap-2">
                    <button
                      class="btn btn-primary w-full"
                      :disabled="store.players.length === 0 || !store.allReady || !store.quizReady"
                      :title="`${store.readyCount}/${store.players.length} ready`"
                      @click="store.startGame()"
                    >
                      <Icon
                        icon="codicon:debug-start"
                        class="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      Start game
                    </button>
                    <button class="btn btn-soft w-full" @click="emit('edit-setup')">
                      <Icon
                        icon="carbon:settings"
                        class="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      />
                      Game Settings
                    </button>
                  </div>
                  <p v-if="store.players.length === 0" class="text-xs opacity-60">
                    Waiting for players to join and mark ready.
                  </p>
                  <p v-else class="text-xs opacity-60">
                    {{ store.readyCount }} / {{ store.players.length }} ready · host starts when
                    100% ready
                  </p>
                </div>
              </section>
              <div class="divider m-0"></div>
              <section class="p-6">
                <TriviaCard :interval-ms="10000" />
              </section>
              <div class="divider m-0"></div>
              <section class="p-6">
                <LobbyChat />
              </section>
            </div>
          </div>
          <aside class="lg:sticky lg:top-4">
            <LobbyRoster
              :players="store.players"
              :max-players="store.maxPlayers"
              :is-host="true"
              @kick="
                (id) => {
                  const t = store.players.find((p) => p.playerId === id)
                  if (t) requestKick(id, t.name)
                }
              "
            />
          </aside>
        </div>
      </div>

      <!-- starting countdown (host can cancel) -->
      <div v-else-if="store.phase === 'starting'" class="mt-4 space-y-4">
        <ConnectionBanner />
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div class="card shadow-xl">
            <div class="card-body items-center gap-4 text-center">
              <p class="text-sm opacity-70">Game starting — countdown is live for players.</p>
              <div class="w-full text-left">
                <LobbyChat />
              </div>
              <button class="btn btn-soft" @click="store.cancelStart()">Cancel start</button>
            </div>
          </div>
          <aside class="w-full lg:sticky lg:top-4">
            <LobbyRoster
              :players="store.players"
              :max-players="store.maxPlayers"
              :is-host="true"
              @kick="
                (id) => {
                  const t = store.players.find((p) => p.playerId === id)
                  if (t) requestKick(id, t.name)
                }
              "
            />
          </aside>
        </div>
        <CountdownOverlay
          :deadline="store.startingDeadline"
          cancellable
          @cancel="store.cancelStart()"
        />
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
          <h2 class="break-words text-xl font-bold sm:text-2xl">{{ store.question }}</h2>
          <p class="text-sm opacity-70">
            {{ answeredCount }} / {{ store.players.length }} answered
            <span v-if="allAnswered" class="badge badge-success badge-sm ml-2">All in!</span>
          </p>
          <div class="grid gap-2">
            <div
              v-for="option in store.options"
              :key="option"
              class="flex items-center justify-between gap-3 rounded-xl border p-4"
              :class="optionBarClass(option)"
            >
              <span class="min-w-0 break-words text-left">{{ option }}</span>
              <span class="shrink-0 font-black">{{ optionCount(option) }}</span>
            </div>
          </div>

          <!-- 3-5s reveal: show correct answer to host (and players see via their own reveal) -->
          <div v-if="countdown.expired.value && correctAnswer" class="alert alert-success">
            <span
              >Correct answer: <strong>{{ correctAnswer }}</strong></span
            >
            <span class="text-xs opacity-70">Next in a few seconds…</span>
          </div>
          <div
            v-else-if="allAnswered && !countdown.expired.value && correctAnswer"
            class="alert alert-info"
          >
            <span
              >All answers in! Revealing correct answer: <strong>{{ correctAnswer }}</strong></span
            >
          </div>

          <div class="flex items-center justify-between gap-2">
            <span v-if="!canAdvance" class="text-sm opacity-60">Waiting for answers…</span>
            <button
              class="btn btn-soft btn-primary ml-auto"
              :disabled="!canAdvance"
              @click="next"
            >
              {{ isLastQuestion ? 'See results' : 'Next question' }}
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- host exit verification -->
    <dialog ref="exitDialogRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Exit quiz?</h3>
        <p class="py-4 text-sm opacity-80">
          This will end the quiz for everyone. Players will see “Quiz has ended by the host”. Are
          you sure you want to exit?
        </p>
        <div class="modal-action">
          <button class="btn btn-soft" @click="exitDialogRef?.close()">Cancel</button>
          <button class="btn btn-soft btn-error" @click="confirmExit">Exit quiz</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>

    <!-- kick verification -->
    <dialog ref="kickDialogRef" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Kick {{ kickTarget?.name }}?</h3>
        <p class="py-4 text-sm opacity-80">
          They will be removed from the lobby and need the room code to rejoin. Continue?
        </p>
        <div class="modal-action">
          <button class="btn btn-soft" @click="cancelKick">Cancel</button>
          <button class="btn btn-soft btn-error" @click="confirmKick">Kick player</button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>

    <!-- join QR code -->
    <dialog ref="qrDialogRef" class="modal">
      <div class="modal-box items-center text-center">
        <h3 class="text-lg font-bold">Scan to join</h3>
        <p class="py-2 text-sm opacity-70">
          Room <strong class="tracking-[0.2em]">{{ store.roomCode }}</strong>
        </p>
        <img
          v-if="joinUrl"
          :src="qrSrc"
          alt="QR code with the link to join this room"
          class="mx-auto h-55 w-55 rounded-xl border border-base-300 bg-white p-2"
          loading="lazy"
          width="220"
          height="220"
        />
        <p class="mt-2 truncate px-4 text-xs opacity-60">{{ joinUrl }}</p>
        <div class="modal-action justify-center">
          <button class="btn btn-soft" @click="qrDialogRef?.close()">Close</button>
          <button class="btn btn-soft" @click="copyLink">
            {{ copied ? 'Copied!' : 'Copy join link' }}
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
