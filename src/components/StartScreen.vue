<script lang="ts" setup>
import { computed, nextTick, ref } from 'vue'
import { MODE_CONFIG, type GameMode, type Mode } from '../quizConfig'
import SettingsMenu from './SettingsMenu.vue'

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
}>()

const props = defineProps<{
  returnFromQuiz: boolean
}>()

type Step = 'landing' | 'mode' | 'form' | 'groupChoice' | 'groupJoin'

const topic = ref('')
const extraTopics = ref<string[]>([])
const mode = ref<Mode>('easy')
const itemCount = ref(5)
const gameMode = ref<GameMode>('solo')
const timed = ref(true)
const maxParticipants = ref(10)
const timePerQuestion = ref(MODE_CONFIG.easy.timerSeconds)
const timeTouched = ref(false)
const step = ref<Step>('landing')
const joinCode = ref('')
const joinName = ref('')
const joinCodeFromUrl = new URLSearchParams(window.location.search).get('room')?.toUpperCase().slice(0, 6) ?? ''

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

// restore saved settings only when returning from a solo quiz (not on hard refresh)
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

const canStart = computed(() => {
  if (allTopics.value.length === 0 || !Number.isFinite(itemCount.value) || itemCount.value < 1) {
    return false
  }
  if (gameMode.value === 'group') {
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
}

const steps = [
  {
    title: 'Pick your topics',
    text: 'Add one topic or several — questions mix and shuffle across them.',
  },
  {
    title: 'Choose how to play',
    text: 'Solo with a timer or at your own pace, or host a live group room.',
  },
  {
    title: 'Answer fast',
    text: 'In group mode, correct answers earn up to 10 points — the faster you answer, the more you score.',
  },
  {
    title: 'See the results',
    text: 'Review your answers solo, or climb the live leaderboard with your group.',
  },
]

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

function startSetup() {
  step.value = 'mode'
  scrollToStep('setup')
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

const canJoinGroup = computed(() => joinCode.value.trim().length === 6 && joinName.value.trim() !== '')

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

function backToLanding() {
  step.value = 'landing'
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
  <div
    class="relative min-h-screen overflow-x-hidden text-base-content"
    style="
      background: linear-gradient(
        160deg,
        color-mix(in oklab, var(--color-primary) 25%, var(--color-base-100)) 0%,
        color-mix(in oklab, var(--color-secondary) 35%, var(--color-base-100)) 55%,
        color-mix(in oklab, var(--color-accent) 30%, var(--color-base-100)) 100%
      );
    "
  >
    <!-- smooth mesh glow overlay -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-3/4 [background-image:radial-gradient(55%_75%_at_18%_8%,color-mix(in_oklab,var(--color-primary)_24%,transparent)_0%,transparent_72%),radial-gradient(45%_65%_at_82%_18%,color-mix(in_oklab,var(--color-secondary)_22%,transparent)_0%,transparent_72%),radial-gradient(38%_55%_at_55%_42%,color-mix(in_oklab,var(--color-accent)_16%,transparent)_0%,transparent_68%)] [mask-image:linear-gradient(to_bottom,#000_35%,transparent)]"
    ></div>

    <!-- navbar -->
    <header class="relative z-20">
      <nav class="mx-auto flex w-full max-w-4xl items-center justify-between px-4 pb-6 pt-8 sm:px-6 sm:pb-8 sm:pt-12 lg:px-8">
        <span class="text-2xl font-black tracking-tight">Quiznix AI</span>
        <SettingsMenu />
      </nav>
    </header>

    <!-- hero -->
    <section class="relative z-10 mx-auto max-w-4xl px-6 pt-8 text-center sm:pt-12">
      <div class="relative inline-block">
        <svg
          class="sparkle sparkle-a absolute -left-6 -top-2 hidden h-6 w-6 fill-current text-primary/70 drop-shadow-[0_2px_10px_color-mix(in_oklab,var(--color-primary)_35%,transparent)] sm:-left-10 sm:-top-4 sm:block sm:h-8 sm:w-8"
          style="rotate: -12deg"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 0C13.5 8.5 15.5 10.5 24 12C15.5 13.5 13.5 15.5 12 24C10.5 15.5 8.5 13.5 0 12C8.5 10.5 10.5 8.5 12 0Z"
          />
        </svg>
        <svg
          class="sparkle sparkle-b absolute -right-8 top-0 hidden h-8 w-8 fill-current text-secondary/70 drop-shadow-[0_2px_10px_color-mix(in_oklab,var(--color-secondary)_35%,transparent)] sm:-right-14 sm:block sm:h-10 sm:w-10"
          style="rotate: 12deg"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 0C13.5 8.5 15.5 10.5 24 12C15.5 13.5 13.5 15.5 12 24C10.5 15.5 8.5 13.5 0 12C8.5 10.5 10.5 8.5 12 0Z"
          />
        </svg>
        <svg
          class="sparkle sparkle-c absolute -right-10 top-1/2 hidden h-6 w-6 fill-current text-accent/70 drop-shadow-[0_2px_10px_color-mix(in_oklab,var(--color-accent)_35%,transparent)] sm:-right-20 sm:block sm:h-7 sm:w-7"
          style="rotate: -6deg"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 0C13.5 8.5 15.5 10.5 24 12C15.5 13.5 13.5 15.5 12 24C10.5 15.5 8.5 13.5 0 12C8.5 10.5 10.5 8.5 12 0Z"
          />
        </svg>
        <h1 class="text-4xl font-black leading-tight tracking-tight sm:text-5xl md:text-7xl">
          Get addicted<br />to learning
        </h1>
      </div>
      <p class="mx-auto mt-6 max-w-xl text-lg font-medium opacity-80">
        Learn any topic you want — AI quizzes make studying easy.
      </p>
      <button
        v-if="step === 'landing'"
        class="btn btn-primary mt-8 h-12 rounded-full px-8 text-base font-semibold shadow-lg"
        @click="startSetup"
      >
        🚀 Start learning
      </button>
    </section>

    <!-- how it works (landing) -->
    <section
      v-if="step === 'landing'"
      id="how-it-works"
      class="relative z-10 mx-auto max-w-4xl px-6 pb-24 pt-20"
    >
      <h2 class="text-center text-3xl font-black tracking-tight md:text-4xl">How it works</h2>
      <p class="mt-2 text-center font-medium opacity-80">From topic to score in four easy steps.</p>
      <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="(step, index) in steps" :key="step.title" class="hover-3d">
          <div class="relative rounded-2xl bg-base-100/90 p-5 shadow-lg backdrop-blur">
            <div
              class="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-content"
            >
              {{ index + 1 }}
            </div>
            <h3 class="mt-3 font-bold text-base-content">{{ step.title }}</h3>
            <p class="mt-1 text-sm text-base-content/70">{{ step.text }}</p>
          </div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      </div>
    </section>

    <!-- game mode picker (replaces hero content after clicking start) -->
    <section
      v-else-if="step === 'mode'"
      id="setup"
      class="relative z-10 mx-auto w-full max-w-3xl px-6 pb-24 pt-10"
    >
      <div class="relative mx-auto mt-8 max-w-3xl sm:mt-16">
        <div class="rounded-2xl bg-base-100 shadow-2xl">
          <span class="absolute -left-6 -top-6 hidden -rotate-12 text-4xl drop-shadow-xl sm:-left-10 sm:-top-8 sm:block sm:text-6xl">🎮</span>
          <span class="absolute -right-6 bottom-4 hidden rotate-12 text-4xl drop-shadow-xl sm:-right-8 sm:bottom-6 sm:block sm:text-6xl">👥</span>

          <div class="border-b border-base-300 px-6 py-4">
            <div
              class="flex items-center justify-center gap-2 text-base font-semibold text-base-content"
            >
              <span class="text-primary">▣</span> How do you want to play?
            </div>
          </div>

          <div class="grid gap-5 p-6 sm:p-10 sm:grid-cols-2">
            <button
              class="group rounded-2xl border-2 border-base-300 p-6 text-left transition hover:border-primary hover:shadow-lg focus:outline-none"
              @click="pickGameMode('solo')"
            >
              <span class="text-4xl">👤</span>
              <h3 class="mt-3 text-lg font-bold text-base-content">Solo</h3>
              <p class="mt-1 text-sm text-base-content/70">
                Practice on your own. Answer each question against the clock.
              </p>
            </button>
            <button
              class="group rounded-2xl border-2 border-base-300 p-6 text-left transition hover:border-primary hover:shadow-lg focus:outline-none"
              @click="pickGameMode('group')"
            >
              <span class="text-4xl">👥</span>
              <h3 class="mt-3 text-lg font-bold text-base-content">Group</h3>
              <p class="mt-1 text-sm text-base-content/70">
                Host a live quiz. Friends join from their gadgets with a room code.
              </p>
            </button>
          </div>

          <div class="border-t border-base-300 px-6 py-4 text-center">
            <button
              class="text-sm font-semibold text-base-content/60 underline-offset-4 hover:underline"
              @click="backToLanding"
            >
              ← Back
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- group: choose create or join -->
    <section
      v-else-if="step === 'groupChoice'"
      id="setup"
      class="relative z-10 mx-auto w-full max-w-3xl px-6 pb-24 pt-10"
    >
      <div class="relative mx-auto mt-8 max-w-3xl sm:mt-16">
        <div class="rounded-2xl bg-base-100 shadow-2xl">
          <span class="absolute -left-6 -top-6 hidden -rotate-12 text-4xl drop-shadow-xl sm:-left-10 sm:-top-8 sm:block sm:text-6xl">👥</span>
          <span class="absolute -right-6 bottom-4 hidden rotate-12 text-4xl drop-shadow-xl sm:-right-8 sm:bottom-6 sm:block sm:text-6xl">🔗</span>

          <div class="border-b border-base-300 px-6 py-4">
            <div
              class="flex items-center justify-center gap-2 text-base font-semibold text-base-content"
            >
              <span class="text-primary">▣</span> Group — what do you want to do?
            </div>
          </div>

          <div class="grid gap-5 p-6 sm:p-10 sm:grid-cols-2">
            <button
              class="group rounded-2xl border-2 border-base-300 p-6 text-left transition hover:border-primary hover:shadow-lg focus:outline-none"
              @click="pickGroupAction('create')"
            >
              <span class="text-4xl">🚀</span>
              <h3 class="mt-3 text-lg font-bold text-base-content">Create room</h3>
              <p class="mt-1 text-sm text-base-content/70">
                Pick topics and host a live quiz. Share the 6-letter code.
              </p>
            </button>
            <button
              class="group rounded-2xl border-2 border-base-300 p-6 text-left transition hover:border-primary hover:shadow-lg focus:outline-none"
              @click="pickGroupAction('join')"
            >
              <span class="text-4xl">🔑</span>
              <h3 class="mt-3 text-lg font-bold text-base-content">Join room</h3>
              <p class="mt-1 text-sm text-base-content/70">
                Have a code? Enter it and join from your gadget.
              </p>
            </button>
          </div>

          <div class="border-t border-base-300 px-6 py-4 text-center">
            <button
              class="text-sm font-semibold text-base-content/60 underline-offset-4 hover:underline"
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
      class="relative z-10 mx-auto w-full max-w-3xl px-6 pb-24 pt-10"
    >
      <div class="relative mx-auto mt-8 max-w-3xl sm:mt-16">
        <div class="rounded-2xl bg-base-100 shadow-2xl">
          <span class="absolute -left-6 -top-6 hidden -rotate-12 text-4xl drop-shadow-xl sm:-left-10 sm:-top-8 sm:block sm:text-6xl">🔑</span>
          <span class="absolute -right-6 bottom-4 hidden rotate-12 text-4xl drop-shadow-xl sm:-right-8 sm:bottom-6 sm:block sm:text-6xl">👋</span>

          <div class="border-b border-base-300 px-6 py-4">
            <div
              class="flex items-center justify-center gap-2 text-base font-semibold text-base-content"
            >
              <span class="text-primary">▣</span> Join a live quiz
            </div>
          </div>

          <form class="grid gap-5 p-6 sm:p-10" @submit.prevent="submitJoinGroup">
            <p class="text-center text-sm opacity-70">Enter the room code your host shared and your name.</p>
            <label class="form-control">
              <span class="label font-semibold">Room code</span>
              <input
                v-model="joinCode"
                type="text"
                maxlength="6"
                placeholder="ABC123"
                class="input input-bordered input-lg w-full rounded-xl text-center text-xl font-black tracking-[0.2em] uppercase focus:outline-none sm:text-2xl sm:tracking-[0.3em]"
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
                class="input input-bordered input-lg w-full rounded-xl focus:outline-none"
              />
            </label>
            <button type="submit" class="btn btn-primary mt-2 h-14 rounded-full text-lg font-semibold" :disabled="!canJoinGroup">
              Join room
            </button>
          </form>

          <div class="border-t border-base-300 px-6 py-4 text-center">
            <button
              class="text-sm font-semibold text-base-content/60 underline-offset-4 hover:underline"
              @click="step = 'groupChoice'; scrollToStep('setup')"
            >
              ← Back to group options
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- quiz setup (chosen mode) -->
    <section v-else-if="step === 'form'" id="setup" class="relative z-10 mx-auto w-full max-w-3xl px-6 pb-24 pt-10">
      <div class="relative mx-auto mt-8 max-w-3xl sm:mt-16">
        <div class="rounded-2xl bg-base-100 shadow-2xl">
          <span class="absolute -left-6 -top-6 hidden -rotate-12 text-4xl drop-shadow-xl sm:-left-10 sm:-top-8 sm:block sm:text-6xl">📜</span>
          <span class="absolute -right-6 bottom-4 hidden rotate-12 text-4xl drop-shadow-xl sm:-right-8 sm:bottom-6 sm:block sm:text-6xl">🧩</span>

          <!-- app top bar -->
          <div class="border-b border-base-300 px-6 py-4">
            <div
              class="flex items-center justify-center gap-2 text-base font-semibold text-base-content"
            >
              <span class="text-primary">▣</span> Set up your {{ gameMode }} quiz
            </div>
          </div>

          <!-- setup form -->
          <form class="grid gap-5 p-6 sm:p-10" @submit.prevent="start" @keydown.enter.prevent>
            <div>
              <label class="label text-base font-semibold text-base-content">Topic</label>
              <div class="flex gap-2">
                <input
                  v-model="topic"
                  type="text"
                  placeholder="Enter a topic..."
                  class="input input-bordered input-lg flex-1 rounded-xl focus:outline-none"
                  @keyup.enter.prevent="addTopic"
                />
                <button
                  type="button"
                  class="btn btn-primary rounded-xl"
                  :disabled="topic.trim() === ''"
                  @click="addTopic"
                >
                  Add
                </button>
              </div>
              <div v-if="allTopics.length > 0" class="mt-2 flex flex-wrap gap-2">
                <span
                  v-for="(item, index) in allTopics"
                  :key="item + index"
                  class="badge badge-soft badge-primary gap-1 py-3"
                >
                  {{ item }}
                  <button
                    type="button"
                    class="btn btn-xs btn-circle btn-ghost min-h-7 min-w-7"
                    :aria-label="`Remove ${item}`"
                    @click="removeTopic(index)"
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
            <div class="grid gap-5 sm:grid-cols-2">
              <label class="text-base font-semibold text-base-content">
                <span class="label">Difficulty</span>
                <select
                  class="select select-bordered select-lg w-full rounded-xl focus:outline-none"
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
                  class="input input-bordered input-lg w-full rounded-xl focus:outline-none"
                />
              </label>
            </div>
            <div v-if="gameMode === 'group'" class="grid gap-5 sm:grid-cols-2">
              <label class="text-base font-semibold text-base-content">
                <span class="label">Max participants</span>
                <input
                  v-model.number="maxParticipants"
                  type="number"
                  min="2"
                  max="100"
                  class="input input-bordered input-lg w-full rounded-xl focus:outline-none"
                />
              </label>
              <label class="text-base font-semibold text-base-content">
                <span class="label">Time per question (seconds)</span>
                <input
                  v-model.number="timePerQuestion"
                  type="number"
                  min="5"
                  max="300"
                  class="input input-bordered input-lg w-full rounded-xl focus:outline-none"
                  @input="timeTouched = true"
                />
              </label>
            </div>
            <div
              v-if="gameMode === 'solo'"
              class="flex items-center justify-between gap-4 rounded-xl border border-base-300 bg-base-200/50 p-4"
            >
              <label class="label cursor-pointer gap-4" for="timer-toggle">
                <span>
                  <span class="label-text font-semibold text-base-content">Question timer</span>
                  <span class="block text-sm text-base-content/60">
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
            <button
              type="submit"
              class="btn btn-primary mt-2 h-14 rounded-full text-lg font-semibold"
              :disabled="!canStart"
            >
              🚀 Start {{ gameMode }} quiz
            </button>
          </form>

          <div class="border-t border-base-300 px-6 py-4 text-center">
            <button
              class="text-sm font-semibold text-base-content/60 underline-offset-4 hover:underline"
              @click="backToMode"
            >
              ← Change game mode
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* sparkle float animation */
.sparkle {
  animation: sparkle-float 4.5s ease-in-out infinite;
}

.sparkle-b {
  animation-delay: -1.5s;
}

.sparkle-c {
  animation-delay: -3s;
}

@keyframes sparkle-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-7px);
  }
}
</style>
