<script lang="ts" setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { MODE_CONFIG, type GameMode, type Mode } from '../../quizConfig'
import { prefetchUselessFact } from '../../composables/useUselessFact'
import { useGroupStore } from '../../stores/groupStore'

// Warm the trivia cache while the user fills the form, so the loading screen
// opens with a fresh fact and shows it stably (no mid-read swap).
onMounted(() => {
  prefetchUselessFact()
  refreshHostResumeOffer()
  window.addEventListener('focus', refreshHostResumeOffer)
  window.addEventListener('storage', refreshHostResumeOffer)
})

onUnmounted(() => {
  window.removeEventListener('focus', refreshHostResumeOffer)
  window.removeEventListener('storage', refreshHostResumeOffer)
})

const groupStore = useGroupStore()
const router = useRouter()

const emit = defineEmits<{
  'start-quiz': [
    payload: {
      topics: string[]
      mode: Mode
      itemCount: number
      gameMode: GameMode
      timed: boolean
      maxPlayers?: number
      timePerQuestion?: number
    },
  ]
  'join-group': [payload: { code: string; name: string }]
  'cancel-edit': []
  'resume-host': []
}>()

const props = defineProps<{
  returnFromQuiz: boolean
  /** Set when the host hit "Play again" on the group leaderboard — prefill
   * the form with their last group settings and jump straight to it. */
  fromGroupReplay?: boolean
}>()

type Step = 'mode' | 'form' | 'groupChoice' | 'groupJoin'

const topic = ref('')
const extraTopics = ref<string[]>([])
const mode = ref<Mode>('easy')
const itemCount = ref(5)
const gameMode = ref<GameMode>('solo')
const timed = ref(true)
const maxParticipants = ref(10)
const timePerQuestion = ref(MODE_CONFIG.easy.timerSeconds)
const timeTouched = ref(false)
// straight to the solo-or-group choice: the dashboard already picked the game
const step = ref<Step>('mode')
const joinCode = ref('')
const joinName = ref('')
const joinCodeFromUrl =
  new URLSearchParams(window.location.search).get('room')?.toUpperCase().slice(0, 6) ?? ''

const resumeRefresh = ref(0)
function refreshHostResumeOffer() {
  resumeRefresh.value++
}

// Reactive host-resume offer: localStorage is not reactive, so re-read it on
// mount, step changes, and window focus/storage events. Suppressed while this
// tab already holds a live host room (e.g. the edit-setup flow keeps the room
// open — offering to "rejoin" it would be wrong).
const hostResumeOffer = computed(() => {
  void resumeRefresh.value
  if (
    groupStore.role === 'host' &&
    (groupStore.phase === 'lobby' ||
      groupStore.phase === 'starting' ||
      groupStore.phase === 'question')
  ) {
    return null
  }
  const offer = groupStore.getResumeOffer()
  return offer && offer.role === 'host' ? offer : null
})
const resumeError = ref('')

function resumeHostSession() {
  if (!hostResumeOffer.value) return
  resumeError.value = ''
  groupStore.resumeHost(hostResumeOffer.value.code)
  emit('resume-host')
}

function dismissHostResume() {
  if (hostResumeOffer.value) groupStore.discardResume(hostResumeOffer.value.code)
  refreshHostResumeOffer()
}

// the mirror can land after mount (reconnect, other tab) — re-check on step changes
watch(step, () => refreshHostResumeOffer())

const allTopics = computed(() => extraTopics.value.filter((item) => item !== ''))

function addTopic() {
  const value = topic.value.trim()
  if (value === '') {
    return
  }
  const exists = allTopics.value.some((item) => item.toLowerCase() === value.toLowerCase())
  if (!exists) {
    extraTopics.value.push(value)
  }
  topic.value = ''
}

function removeTopic(index: number) {
  extraTopics.value.splice(index, 1)
}

// restore saved settings only when returning from a quiz (not on hard refresh)
if (props.returnFromQuiz) {
  const saved = localStorage.getItem('quiznix-setup')
  if (saved) {
    try {
      const s = JSON.parse(saved) as {
        topics: string[]
        mode: Mode
        itemCount: number
        gameMode: GameMode
        timed: boolean
      }
      if (s.gameMode === 'solo') {
        topic.value = ''
        extraTopics.value = s.topics ?? []
        mode.value = s.mode || 'easy'
        itemCount.value = s.itemCount || 5
        timed.value = s.timed !== false
        step.value = 'form'
      }
    } catch {
      /* ignore */
    }
  }
}

// Host hit "Play again" — restore their last group settings and jump to the form
if (props.fromGroupReplay) {
  const saved = localStorage.getItem('quiznix-setup-group')
  if (saved) {
    try {
      const s = JSON.parse(saved) as {
        topics: string[]
        mode: Mode
        itemCount: number
        maxParticipants: number
        timePerQuestion: number
      }
      topic.value = ''
      extraTopics.value = s.topics ?? []
      mode.value = s.mode || 'easy'
      itemCount.value = s.itemCount || 5
      maxParticipants.value = s.maxParticipants || 10
      timePerQuestion.value = s.timePerQuestion || MODE_CONFIG[s.mode || 'easy'].timerSeconds
      timeTouched.value = true
      gameMode.value = 'group'
      step.value = 'form'
    } catch {
      /* ignore */
    }
  }
}

const canStart = computed(() => {
  if (allTopics.value.length === 0 || !Number.isFinite(itemCount.value) || itemCount.value < 1) {
    return false
  }
  if (gameMode.value === 'group') {
    if (Math.floor(itemCount.value) < allTopics.value.length) return false
    const playersOk =
      Number.isInteger(maxParticipants.value) &&
      maxParticipants.value >= 2 &&
      maxParticipants.value <= 100
    const timeOk =
      Number.isInteger(timePerQuestion.value) &&
      timePerQuestion.value >= 5 &&
      timePerQuestion.value <= 300
    return playersOk && timeOk
  }
  return true
})

function saveSettings() {
  localStorage.setItem(
    'quiznix-setup',
    JSON.stringify({
      topics: allTopics.value,
      mode: mode.value,
      itemCount: itemCount.value,
      gameMode: gameMode.value,
      timed: timed.value,
    }),
  )
  // also remember group-mode fields so "Play again" can prefill them
  if (gameMode.value === 'group') {
    localStorage.setItem(
      'quiznix-setup-group',
      JSON.stringify({
        topics: allTopics.value,
        mode: mode.value,
        itemCount: itemCount.value,
        maxParticipants: maxParticipants.value,
        timePerQuestion: timePerQuestion.value,
      }),
    )
  }
}

function onModeChange(event: Event) {
  mode.value = (event.target as HTMLSelectElement).value as Mode
  if (!timeTouched.value) {
    timePerQuestion.value = MODE_CONFIG[mode.value].timerSeconds
  }
}

function scrollToStep(sectionId: string) {
  void nextTick(() => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth' })
  })
}

function backToDashboard() {
  void router.push('/')
}

function pickGameMode(selected: GameMode) {
  gameMode.value = selected
  topic.value = ''
  extraTopics.value = []
  if (selected === 'group') {
    joinCode.value = joinCodeFromUrl
    joinName.value = ''
    step.value = 'groupChoice'
  } else {
    step.value = 'form'
  }
  scrollToStep('setup')
}

function pickGroupAction(action: 'create' | 'join') {
  if (action === 'create') {
    step.value = 'form'
  } else {
    joinCode.value = joinCodeFromUrl
    step.value = 'groupJoin'
  }
  scrollToStep('setup')
}

const canJoinGroup = computed(
  () => joinCode.value.trim().length === 6 && joinName.value.trim() !== '',
)

function submitJoinGroup() {
  if (!canJoinGroup.value) return
  emit('join-group', { code: joinCode.value.trim().toUpperCase(), name: joinName.value.trim() })
}

function backToMode() {
  if (gameMode.value === 'group') {
    step.value = 'groupChoice'
  } else {
    step.value = 'mode'
  }
  scrollToStep('setup')
}

function backToGroupChoice() {
  step.value = 'groupChoice'
  scrollToStep('setup')
}

function start() {
  saveSettings()
  emit('start-quiz', {
    topics: allTopics.value,
    mode: mode.value,
    itemCount: Math.max(1, Math.floor(itemCount.value || 1)),
    gameMode: gameMode.value,
    timed: timed.value,
    maxPlayers: Math.min(100, Math.max(2, Math.floor(maxParticipants.value || 10))),
    timePerQuestion: Math.min(300, Math.max(5, Math.floor(timePerQuestion.value || 15))),
  })
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl">
    <!-- game mode picker: this is where /quiz lands, the dashboard picked the game -->
    <section
      v-if="step === 'mode'"
      id="setup"
      class="mx-auto w-full max-w-3xl px-4 pt-10 pb-20 sm:pt-14"
    >
      <div class="relative mx-auto max-w-3xl">
        <div class="panel overflow-hidden">
          <div class="border-base-300 flex items-center justify-center gap-2.5 border-b px-6 py-4">
            <Icon icon="lucide:gamepad-2" class="text-primary h-4 w-4" aria-hidden="true" />
            <span class="font-mono text-[11px] tracking-[0.2em] uppercase opacity-80"
              >How do you want to play?</span
            >
          </div>

          <div class="grid gap-4 p-6 sm:grid-cols-2 sm:p-10">
            <button
              class="panel-quiet hover:border-primary/60 group p-6 text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
              @click="pickGameMode('solo')"
            >
              <span
                class="border-base-300 bg-base-100 text-primary flex h-11 w-11 items-center justify-center rounded-[0.45rem] border"
              >
                <Icon icon="lucide:user-round" class="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 class="mt-4 font-semibold">Solo</h3>
              <p class="text-base-content/60 mt-1.5 text-sm leading-relaxed">
                Practice on your own. Answer each question against the clock.
              </p>
            </button>
            <button
              class="panel-quiet hover:border-primary/60 group p-6 text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
              @click="pickGameMode('group')"
            >
              <span
                class="border-base-300 bg-base-100 text-secondary flex h-11 w-11 items-center justify-center rounded-[0.45rem] border"
              >
                <Icon icon="lucide:users-round" class="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 class="mt-4 font-semibold">Group</h3>
              <p class="text-base-content/60 mt-1.5 text-sm leading-relaxed">
                Host a live quiz. Friends join from their gadgets with a room code.
              </p>
            </button>
          </div>

          <div class="border-base-300 border-t px-6 py-4 text-center">
            <button
              class="btn btn-ghost btn-sm font-mono text-[10px] tracking-[0.16em] uppercase"
              @click="backToDashboard"
            >
              ← All games
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- group: choose create or join -->
    <section
      v-else-if="step === 'groupChoice'"
      id="setup"
      class="mx-auto w-full max-w-3xl px-4 pt-10 pb-20 sm:pt-14"
    >
      <div class="relative mx-auto max-w-3xl">
        <div class="panel overflow-hidden">
          <div class="border-base-300 flex items-center justify-center gap-2.5 border-b px-6 py-4">
            <Icon icon="lucide:users" class="text-primary h-4 w-4" aria-hidden="true" />
            <span class="font-mono text-[11px] tracking-[0.2em] uppercase opacity-80"
              >Group — what do you want to do?</span
            >
          </div>

          <div v-if="hostResumeOffer" class="px-6 pt-6 sm:px-10 sm:pt-8">
            <div class="alert alert-info text-sm">
              <span
                >Your room <strong>{{ hostResumeOffer.code }}</strong> may still be live. Rejoin as
                host?</span
              >
              <div class="flex gap-2">
                <button class="btn btn-primary btn-sm" @click="resumeHostSession">Reconnect</button>
                <button class="btn btn-warning btn-sm" @click="dismissHostResume">Dismiss</button>
              </div>
            </div>
            <p v-if="resumeError" role="alert" class="text-error mt-2 text-sm">{{ resumeError }}</p>
          </div>

          <div class="grid gap-4 p-6 sm:grid-cols-2 sm:p-10">
            <button
              class="panel-quiet hover:border-primary/60 group p-6 text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
              @click="pickGroupAction('create')"
            >
              <span
                class="border-base-300 bg-base-100 text-primary flex h-11 w-11 items-center justify-center rounded-[0.45rem] border"
              >
                <Icon icon="lucide:rocket" class="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 class="mt-4 font-semibold">Create room</h3>
              <p class="text-base-content/60 mt-1.5 text-sm leading-relaxed">
                Pick topics and host a live quiz. Share the 6-letter code.
              </p>
            </button>
            <button
              class="panel-quiet hover:border-primary/60 group p-6 text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
              @click="pickGroupAction('join')"
            >
              <span
                class="border-base-300 bg-base-100 text-secondary flex h-11 w-11 items-center justify-center rounded-[0.45rem] border"
              >
                <Icon icon="lucide:key-round" class="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 class="mt-4 font-semibold">Join room</h3>
              <p class="text-base-content/60 mt-1.5 text-sm leading-relaxed">
                Have a code? Enter it and join from your gadget.
              </p>
            </button>
          </div>

          <div class="border-base-300 border-t px-6 py-4 text-center">
            <button
              class="btn btn-ghost btn-sm font-mono text-[10px] tracking-[0.16em] uppercase"
              @click="backToMode"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- group: join with code -->
    <section
      v-else-if="step === 'groupJoin'"
      id="setup"
      class="mx-auto w-full max-w-3xl px-4 pt-10 pb-20 sm:pt-14"
    >
      <div class="relative mx-auto max-w-3xl">
        <div class="panel overflow-hidden">
          <div class="border-base-300 flex items-center justify-center gap-2.5 border-b px-6 py-4">
            <Icon icon="lucide:door-open" class="text-primary h-4 w-4" aria-hidden="true" />
            <span class="font-mono text-[11px] tracking-[0.2em] uppercase opacity-80"
              >Join a live quiz</span
            >
          </div>

          <form class="grid gap-5 p-6 sm:p-10" @submit.prevent="submitJoinGroup">
            <p class="text-center text-sm opacity-70">
              Enter the room code your host shared and your name.
            </p>
            <label class="form-control">
              <span class="label font-semibold">Room code</span>
              <input
                v-model="joinCode"
                type="text"
                maxlength="6"
                placeholder="ABC123"
                class="input input-bordered input-lg pixel-number w-full text-center text-xl tracking-[0.2em] uppercase focus:outline-none sm:text-2xl sm:tracking-[0.3em]"
                @input="(e) => (joinCode = (e.target as HTMLInputElement).value.toUpperCase())"
              />
            </label>
            <label class="form-control">
              <span class="label font-semibold">Your name</span>
              <input
                v-model="joinName"
                type="text"
                maxlength="24"
                placeholder="e.g. Ana"
                class="input input-bordered input-lg w-full focus:outline-none"
              />
            </label>
            <button
              type="submit"
              class="btn btn-primary mt-2 h-14 text-lg font-semibold"
              :disabled="!canJoinGroup"
            >
              Join room
            </button>
          </form>

          <div class="border-base-300 border-t px-6 py-4 text-center">
            <button
              class="btn btn-ghost btn-sm font-mono text-[10px] tracking-[0.16em] uppercase"
              @click="backToGroupChoice"
            >
              ← Back to group options
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- quiz setup (chosen mode) -->
    <section
      v-else-if="step === 'form'"
      id="setup"
      class="mx-auto w-full max-w-3xl px-4 pt-10 pb-20 sm:pt-14"
    >
      <div class="relative mx-auto max-w-3xl">
        <div class="panel overflow-hidden">
          <div class="border-base-300 flex items-center justify-center gap-2.5 border-b px-6 py-4">
            <Icon
              icon="lucide:sliders-horizontal"
              class="text-primary h-4 w-4"
              aria-hidden="true"
            />
            <span class="font-mono text-[11px] tracking-[0.2em] uppercase opacity-80"
              >Set up your {{ gameMode }} quiz</span
            >
          </div>

          <div v-if="hostResumeOffer && gameMode === 'group'" class="px-6 pt-6 sm:px-10 sm:pt-8">
            <div class="alert alert-info text-sm">
              <span
                >Your room <strong>{{ hostResumeOffer.code }}</strong> may still be live. Rejoin as
                host?</span
              >
              <div class="flex gap-2">
                <button class="btn btn-primary btn-sm" @click="resumeHostSession">Reconnect</button>
                <button class="btn btn-warning btn-sm" @click="dismissHostResume">Dismiss</button>
              </div>
            </div>
            <p v-if="resumeError" role="alert" class="text-error mt-2 text-sm">{{ resumeError }}</p>
          </div>

          <!-- setup form -->
          <form class="grid gap-5 p-6 sm:p-10" @submit.prevent="start" @keydown.enter.prevent>
            <div
              v-if="fromGroupReplay && groupStore.roomExpired"
              class="alert alert-warning text-sm"
            >
              <span
                >The previous room expired on the server — finalizing opens a fresh room code.</span
              >
            </div>
            <div>
              <label class="label text-base font-semibold text-base-content">Topic/s</label>
              <div class="flex flex-col gap-2 sm:flex-row">
                <input
                  v-model="topic"
                  type="text"
                  placeholder="Enter a topic..."
                  class="input input-bordered input-lg w-full focus:outline-none"
                  @keyup.enter.prevent="addTopic"
                />
                <button
                  type="button"
                  class="btn btn-outline border-base-300 w-full shrink-0 hover:border-primary hover:bg-base-200 sm:w-auto"
                  :disabled="topic.trim() === ''"
                  @click="addTopic"
                >
                  Add
                </button>
              </div>
              <div v-if="allTopics.length > 0" class="mt-3 flex flex-wrap gap-2">
                <span
                  v-for="(item, index) in allTopics"
                  :key="item + index"
                  class="badge border-primary/35 bg-primary/10 text-primary gap-1.5 py-3 font-mono text-[11px]"
                >
                  {{ item }}
                  <button
                    type="button"
                    class="hover:text-error cursor-pointer text-base leading-none font-bold opacity-60 transition"
                    :aria-label="`Remove ${item}`"
                    @click="removeTopic(index)"
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
            <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <label class="text-base font-semibold text-base-content">
                <span class="label">Difficulty</span>
                <select
                  class="select select-bordered select-lg w-full focus:outline-none"
                  :value="mode"
                  @change="onModeChange"
                >
                  <option v-for="(config, key) in MODE_CONFIG" :key="key" :value="key">
                    {{ config.label }}
                  </option>
                </select>
              </label>
              <label class="text-base font-semibold text-base-content">
                <span class="label">Number of items</span>
                <input
                  v-model.number="itemCount"
                  type="number"
                  min="1"
                  class="input input-bordered input-lg w-full focus:outline-none"
                />
              </label>
            </div>
            <div v-if="gameMode === 'group'" class="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <label class="text-base font-semibold text-base-content">
                <span class="label">Max participants</span>
                <input
                  v-model.number="maxParticipants"
                  type="number"
                  min="2"
                  max="100"
                  class="input input-bordered input-lg w-full focus:outline-none"
                />
              </label>
              <label class="text-base font-semibold text-base-content">
                <span class="label">Time per question (seconds)</span>
                <input
                  v-model.number="timePerQuestion"
                  type="number"
                  min="5"
                  max="300"
                  class="input input-bordered input-lg w-full focus:outline-none"
                  @input="timeTouched = true"
                />
              </label>
            </div>
            <div
              v-if="gameMode === 'solo'"
              class="panel-quiet flex flex-col items-start justify-between gap-4 p-4 sm:flex-row sm:items-center"
            >
              <label class="label cursor-pointer gap-4" for="timer-toggle">
                <span>
                  <span class="label-text font-semibold text-base-content">Question timer</span>
                  <span class="text-base-content/60 block text-sm">
                    {{
                      timed
                        ? `${MODE_CONFIG[mode].timerSeconds} seconds per question`
                        : 'No time limit — answer at your own pace'
                    }}
                  </span>
                </span>
              </label>
              <input
                id="timer-toggle"
                v-model="timed"
                type="checkbox"
                class="toggle toggle-success"
              />
            </div>
            <p
              v-if="
                gameMode === 'group' &&
                allTopics.length > 0 &&
                Math.floor(itemCount || 0) < allTopics.length
              "
              class="text-error text-sm"
            >
              Need at least {{ allTopics.length }} questions for {{ allTopics.length }} topics.
            </p>
            <div class="mt-2 flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                class="btn btn-primary flex-1 text-center whitespace-normal"
                :disabled="!canStart"
              >
                {{ fromGroupReplay ? 'Finalize questions' : `Start ${gameMode} quiz` }}
              </button>
              <button
                v-if="fromGroupReplay"
                type="button"
                class="btn btn-outline border-base-300 flex-1 text-center whitespace-normal hover:bg-base-200"
                @click="emit('cancel-edit')"
              >
                Discard Changes
              </button>
            </div>
          </form>

          <div class="border-base-300 border-t px-6 py-4 text-center">
            <button
              v-if="!fromGroupReplay"
              class="btn btn-ghost btn-sm font-mono text-[10px] tracking-[0.16em] uppercase"
              @click="backToMode"
            >
              ← Change game mode
            </button>
            <button
              v-else
              class="btn btn-ghost btn-sm font-mono text-[10px] tracking-[0.16em] uppercase"
              @click="emit('cancel-edit')"
            >
              ← Back to lobby
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
