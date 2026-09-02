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
}>()

const props = defineProps<{
  returnFromQuiz: boolean
}>()

type Step = 'landing' | 'mode' | 'form'

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
  const saved = localStorage.getItem('quiztify-setup')
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
    'quiztify-setup',
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
  step.value = 'form'
  scrollToStep('setup')
}

function backToMode() {
  step.value = 'mode'
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
      <nav class="mx-auto flex w-full max-w-4xl items-center justify-between px-8 pb-8 pt-12">
        <span class="text-2xl font-black tracking-tight">Quizly AI</span>
        <SettingsMenu />
      </nav>
    </header>

    <!-- hero -->
    <section class="relative z-10 mx-auto max-w-4xl px-6 pt-12 text-center">
      <div class="relative inline-block">
        <svg
          class="sparkle sparkle-a absolute -left-10 -top-4 h-8 w-8 fill-current text-primary/70 drop-shadow-[0_2px_10px_color-mix(in_oklab,var(--color-primary)_35%,transparent)]"
          style="rotate: -12deg"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 0C13.5 8.5 15.5 10.5 24 12C15.5 13.5 13.5 15.5 12 24C10.5 15.5 8.5 13.5 0 12C8.5 10.5 10.5 8.5 12 0Z"
          />
        </svg>
        <svg
          class="sparkle sparkle-b absolute -right-14 top-0 h-10 w-10 fill-current text-secondary/70 drop-shadow-[0_2px_10px_color-mix(in_oklab,var(--color-secondary)_35%,transparent)]"
          style="rotate: 12deg"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 0C13.5 8.5 15.5 10.5 24 12C15.5 13.5 13.5 15.5 12 24C10.5 15.5 8.5 13.5 0 12C8.5 10.5 10.5 8.5 12 0Z"
          />
        </svg>
        <svg
          class="sparkle sparkle-c absolute -right-20 top-1/2 h-7 w-7 fill-current text-accent/70 drop-shadow-[0_2px_10px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]"
          style="rotate: -6deg"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 0C13.5 8.5 15.5 10.5 24 12C15.5 13.5 13.5 15.5 12 24C10.5 15.5 8.5 13.5 0 12C8.5 10.5 10.5 8.5 12 0Z"
          />
        </svg>
        <h1 class="text-5xl font-black leading-tight tracking-tight md:text-7xl">
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
      <div class="relative mx-auto mt-16 max-w-3xl">
        <div class="rounded-2xl bg-base-100 shadow-2xl">
          <span class="absolute -left-10 -top-8 -rotate-12 text-6xl drop-shadow-xl">🎮</span>
          <span class="absolute -right-8 bottom-6 rotate-12 text-6xl drop-shadow-xl">👥</span>

          <div class="border-b border-base-300 px-6 py-4">
            <div
              class="flex items-center justify-center gap-2 text-base font-semibold text-base-content"
            >
              <span class="text-primary">▣</span> How do you want to play?
            </div>
          </div>

          <div class="grid gap-5 p-8 sm:p-10 sm:grid-cols-2">
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
                Host a live quiz. Friends join from their phones with a room code.
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

    <!-- quiz setup (chosen mode) -->
    <section v-else id="setup" class="relative z-10 mx-auto w-full max-w-3xl px-6 pb-24 pt-10">
      <div class="relative mx-auto mt-16 max-w-3xl">
        <div class="rounded-2xl bg-base-100 shadow-2xl">
          <span class="absolute -left-10 -top-8 -rotate-12 text-6xl drop-shadow-xl">📜</span>
          <span class="absolute -right-8 bottom-6 rotate-12 text-6xl drop-shadow-xl">🧩</span>

          <!-- app top bar -->
          <div class="border-b border-base-300 px-6 py-4">
            <div
              class="flex items-center justify-center gap-2 text-base font-semibold text-base-content"
            >
              <span class="text-primary">▣</span> Set up your {{ gameMode }} quiz
            </div>
          </div>

          <!-- setup form -->
          <form class="grid gap-5 p-8 sm:p-10" @submit.prevent="start" @keydown.enter.prevent>
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
                    class="btn btn-xs btn-circle btn-ghost"
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
