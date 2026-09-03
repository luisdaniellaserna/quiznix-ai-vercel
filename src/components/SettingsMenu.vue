<script lang="ts" setup>
import { onUnmounted, ref } from 'vue'
import { Icon } from '@iconify/vue'

const themes = [
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'synthwave',
  'retro',
  'cyberpunk',
  'valentine',
  'halloween',
  'garden',
  'forest',
  'aqua',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'luxury',
  'dracula',
  'cmyk',
  'autumn',
  'business',
  'acid',
  'lemonade',
  'night',
  'coffee',
  'winter',
  'dim',
  'nord',
  'sunset',
  'caramellatte',
  'abyss',
  'silk',
]
const THEME_STORAGE_KEY = 'quiznix-theme'
function getInitialTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved && themes.includes(saved)) return saved
  } catch {}
  return 'light'
}
const currentTheme = ref(getInitialTheme())
// apply theme immediately so the page matches the stored choice before any interaction
try {
  document.documentElement.setAttribute('data-theme', currentTheme.value)
} catch {}
const reportDetail = ref('')
const reportEmail = (import.meta.env.VITE_REPORT_EMAIL as string | undefined)?.trim() ?? ''

const props = withDefaults(
  defineProps<{
    showQuit: boolean
  }>(),
  {
    showQuit: false,
  },
)
const emit = defineEmits(['quit-quiz'])

const dropdownRef = ref<HTMLDetailsElement | null>(null)
const themeDialogRef = ref<HTMLDialogElement | null>(null)
const helpDialogRef = ref<HTMLDialogElement | null>(null)
const reportDialogRef = ref<HTMLDialogElement | null>(null)
const quitDialogRef = ref<HTMLDialogElement | null>(null)
let savedScrollY = 0

function lockPageScroll() {
  const locked = dropdownRef.value?.open ?? false
  if (locked) {
    savedScrollY = window.scrollY
  }
  document.documentElement.style.overflow = locked ? 'clip' : ''
  if (window.scrollY !== savedScrollY) {
    window.scrollTo(0, savedScrollY)
  }
  requestAnimationFrame(() => {
    if (window.scrollY !== savedScrollY) {
      window.scrollTo(0, savedScrollY)
    }
  })
}

function closeDropdown() {
  dropdownRef.value?.removeAttribute('open')
}

function openMenu(menu: 'theme' | 'help' | 'report') {
  closeDropdown()
  const dialog = { theme: themeDialogRef, help: helpDialogRef, report: reportDialogRef }[menu].value
  if (dialog && !dialog.open) {
    dialog.showModal()
    dialog.querySelector('.modal-box')?.scrollTo(0, 0)
  }
}

function selectTheme(theme: string) {
  currentTheme.value = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    document.documentElement.setAttribute('data-theme', theme)
  } catch {}
  themeDialogRef.value?.close()
}

function submitReport() {
  const subject = encodeURIComponent('Quiznix AI — bug report')
  const body = encodeURIComponent(reportDetail.value.trim() || 'No details provided.')
  const recipient = reportEmail ? `${reportEmail}?` : ''
  window.location.href = `mailto:${recipient}subject=${subject}&body=${body}`
}

function askQuit() {
  closeDropdown()
  quitDialogRef.value?.showModal()
}

function confirmQuit() {
  quitDialogRef.value?.close()
  emit('quit-quiz')
}

onUnmounted(() => {
  document.documentElement.style.overflow = ''
})
</script>

<template>
  <details ref="dropdownRef" class="dropdown dropdown-end" @toggle="lockPageScroll">
    <summary class="btn btn-ghost btn-circle group min-h-11 min-w-11" aria-label="Settings">
      <Icon
        icon="lucide:settings"
        class="h-5 w-5 transition-transform duration-300 group-hover:rotate-90"
      />
    </summary>

    <div class="dropdown-content card card-sm z-50 w-60 max-w-[calc(100vw-1rem)] bg-base-200 p-1.5 shadow-xl">
      <h2 class="px-3 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wide opacity-70">
        Settings
      </h2>
      <div class="space-y-0.5">
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-base-300/50"
          @click="openMenu('theme')"
        >
          <Icon icon="lucide:palette" class="h-4 w-4 shrink-0 opacity-80" />
          Change Theme
        </button>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-base-300/50"
          @click="openMenu('help')"
        >
          <Icon icon="lucide:circle-question-mark" class="h-4 w-4 shrink-0 opacity-80" />
          Help
        </button>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-error hover:bg-base-300/50"
          v-if="props.showQuit"
          @click="askQuit"
        >
          <Icon icon="lucide:log-out" class="h-4 w-4 shrink-0 opacity-80" />
          Quit quiz
        </button>
        <div v-if="props.showQuit" class="my-1 h-px bg-base-300"></div>
        <button
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-base-300/50"
          @click="openMenu('report')"
        >
          <Icon icon="lucide:flag" class="h-4 w-4 shrink-0 opacity-80" />
          Report
        </button>
      </div>
    </div>
  </details>

  <!-- Change Theme -->
  <dialog ref="themeDialogRef" class="modal">
    <div class="modal-box scrollbar-hidden overflow-hidden max-w-md">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Change Theme</h3>
        <button
          class="btn btn-ghost btn-circle min-h-11 min-w-11"
          aria-label="Close"
          @click="themeDialogRef?.close()"
        >
          <Icon icon="lucide:x" class="h-5 w-5" />
        </button>
      </div>
      <ul class="mt-4 grid max-h-80 grid-cols-1 gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-2">
        <li v-for="theme in themes" :key="theme">
          <label
            class="flex cursor-pointer items-center gap-2 rounded-lg border border-base-300 p-2 transition hover:border-base-content/40 hover:bg-base-200/60"
          >
            <input
              type="radio"
              name="theme-picker"
              class="theme-controller peer sr-only"
              :value="theme"
              :checked="theme === currentTheme"
              @change="selectTheme(theme)"
            />
            <span
              class="grid h-4 w-4 shrink-0 grid-cols-2 gap-0.5 rounded-sm p-0.5"
              :data-theme="theme"
            >
              <span class="h-1 w-1 rounded-full bg-primary"></span>
              <span class="h-1 w-1 rounded-full bg-secondary"></span>
              <span class="h-1 w-1 rounded-full bg-accent"></span>
              <span class="h-1 w-1 rounded-full bg-neutral"></span>
            </span>
            <span class="grow truncate text-sm">{{ theme }}</span>
            <Icon
              icon="lucide:check"
              class="h-4 w-4 shrink-0 opacity-0 transition peer-checked:opacity-100"
            />
          </label>
        </li>
      </ul>
      <p class="mt-3 text-xs opacity-60">The theme applies instantly to the whole app.</p>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>

  <!-- Help -->
  <dialog ref="helpDialogRef" class="modal">
    <div class="modal-box scrollbar-hidden max-w-md">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Help</h3>
        <button
          class="btn btn-ghost btn-circle min-h-11 min-w-11"
          aria-label="Close"
          @click="helpDialogRef?.close()"
        >
          <Icon icon="lucide:x" class="h-5 w-5" />
        </button>
      </div>
      <div class="mt-4 space-y-4 text-sm leading-relaxed">
        <section>
          <h4 class="mb-1 font-semibold">Getting started</h4>
          <ol class="list-decimal space-y-1 pl-5 opacity-90">
            <li>Type a topic you want to learn about — add more with “+ Add topic”.</li>
            <li>Pick a difficulty and question count, then hit Start Learning.</li>
            <li>Answer each question; the correct answer is revealed right away.</li>
            <li>Finish the set to see your score.</li>
          </ol>
        </section>
        <section>
          <h4 class="mb-1 font-semibold">Solo vs Group</h4>
          <p class="opacity-90">
            Solo quizzes can run with a timer or without. Group mode creates a room your friends
            join with a code from their own devices — everyone answers live while you host.
          </p>
        </section>
        <section>
          <h4 class="mb-1 font-semibold">Navigating questions</h4>
          <p class="opacity-90">
            Use Back to review earlier questions (before time runs out). Quit returns to the start
            screen and keeps your setup.
          </p>
        </section>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>

  <!-- Report -->
  <dialog ref="reportDialogRef" class="modal">
    <div class="modal-box scrollbar-hidden max-w-md">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-bold">Report a problem</h3>
        <button
          class="btn btn-ghost btn-circle min-h-11 min-w-11"
          aria-label="Close"
          @click="reportDialogRef?.close()"
        >
          <Icon icon="lucide:x" class="h-5 w-5" />
        </button>
      </div>
      <p class="mt-2 text-sm opacity-80">Found a bug or something confusing? Describe it below.</p>
      <textarea
        v-model="reportDetail"
        class="textarea textarea-bordered mt-3 w-full"
        rows="5"
        placeholder="What happened? Which screen were you on, and what did you expect instead?"
      ></textarea>
      <p class="mt-2 text-xs opacity-60">
        Sending opens your email app addressed to the developer with the report pre-filled — just
        hit send.
      </p>
      <div class="modal-action">
        <button class="btn btn-ghost" @click="reportDialogRef?.close()">Cancel</button>
        <button
          class="btn btn-primary"
          :disabled="reportDetail.trim() === ''"
          @click="submitReport"
        >
          Send report
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>

  <!-- Quit -->
  <dialog ref="quitDialogRef" class="modal">
    <div class="modal-box">
      <h3 class="text-lg font-bold">Quit quiz?</h3>
      <p class="py-4">Your progress will be lost. Are you sure you want to quit?</p>
      <div class="modal-action">
        <button class="btn" @click="quitDialogRef?.close()">Cancel</button>
        <button class="btn btn-error" @click="confirmQuit">Yes, quit</button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>
</template>
