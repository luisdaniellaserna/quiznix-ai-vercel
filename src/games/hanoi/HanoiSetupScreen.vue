<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { MAX_DISKS, MIN_DISKS, optimalMoves } from '../../../shared/hanoiRules.mjs'
import { formatDuration } from './format'
import { loadBests } from './bests'

type PlayMode = 'solo' | 'race'

const props = withDefaults(
  defineProps<{
    /** Prefill for a `?room=CODE` join link. */
    initialCode?: string
    /** Open straight into the race side of the screen. */
    initialMode?: PlayMode
  }>(),
  { initialCode: '', initialMode: 'solo' },
)

const emit = defineEmits<{
  start: [payload: { disks: number }]
  host: [payload: { disks: number; maxPlayers: number; name: string }]
  join: [payload: { code: string; name: string }]
}>()

const SETUP_KEY = 'quiznix-hanoi-setup'
const MIN_DEFAULT_DISKS = 4
const PLAYER_OPTIONS = [2, 3, 4, 5, 6, 8, 10]

function savedDisks(): number {
  try {
    const raw = localStorage.getItem(SETUP_KEY)
    if (!raw) return MIN_DEFAULT_DISKS
    const parsed = JSON.parse(raw) as { disks?: number }
    const disks = Number(parsed.disks)
    if (Number.isInteger(disks) && disks >= MIN_DISKS && disks <= MAX_DISKS) return disks
  } catch {
    /* ignore */
  }
  return MIN_DEFAULT_DISKS
}

const mode = ref<PlayMode>(props.initialMode)
const disks = ref(savedDisks())
const maxPlayers = ref(4)
const bests = ref(loadBests())
const diskOptions = Array.from({ length: MAX_DISKS - MIN_DISKS + 1 }, (_, i) => MIN_DISKS + i)
const best = computed(() => bests.value[disks.value] ?? null)

const joinCode = ref(props.initialCode.toUpperCase().slice(0, 6))
const joinName = ref('')
const hostName = ref('')
const formError = ref('')

function persistSetup() {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify({ disks: disks.value }))
  } catch {
    /* ignore */
  }
}

function start() {
  persistSetup()
  emit('start', { disks: disks.value })
}

function host() {
  persistSetup()
  const name = hostName.value.trim()
  if (name === '') {
    formError.value = 'Enter your name — you race too.'
    return
  }
  formError.value = ''
  emit('host', { disks: disks.value, maxPlayers: maxPlayers.value, name })
}

function join() {
  const code = joinCode.value.trim().toUpperCase()
  const name = joinName.value.trim()
  if (code.length !== 6) {
    formError.value = 'Enter the 6-character room code.'
    return
  }
  if (name === '') {
    formError.value = 'Enter your name.'
    return
  }
  formError.value = ''
  emit('join', { code, name })
}
</script>

<template>
  <section class="mx-auto w-full max-w-2xl">
    <div class="rounded-2xl bg-base-100 p-6 shadow-xl sm:p-8">
      <h1 class="text-2xl font-black tracking-tight">Tower of Hanoi</h1>
      <p class="mt-2 text-sm opacity-70">
        Move the whole stack to the far right peg. A larger disk never sits on a smaller one. The
        clock runs while you solve — it measures you, it never stops you.
      </p>

      <div class="mt-6 flex gap-2">
        <button
          type="button"
          class="btn flex-1"
          :class="mode === 'solo' ? 'btn-primary' : 'btn-soft'"
          :aria-pressed="mode === 'solo'"
          @click="mode = 'solo'"
        >
          <Icon icon="lucide:user" class="h-4 w-4" />
          Solo
        </button>
        <button
          type="button"
          class="btn flex-1"
          :class="mode === 'race' ? 'btn-primary' : 'btn-soft'"
          :aria-pressed="mode === 'race'"
          @click="mode = 'race'"
        >
          <Icon icon="lucide:swords" class="h-4 w-4" />
          Race
        </button>
      </div>

      <p class="mt-4 text-sm font-semibold">How many disks?</p>
      <div class="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <button
          v-for="size in diskOptions"
          :key="size"
          type="button"
          class="cursor-pointer rounded-xl border-2 px-2 py-3 text-center transition"
          :class="
            size === disks
              ? 'border-primary bg-primary/10'
              : 'border-base-300 hover:border-primary/60'
          "
          :aria-pressed="size === disks"
          @click="disks = size"
        >
          <span class="block text-xl font-black">{{ size }}</span>
          <span class="block text-[10px] font-medium opacity-60">
            {{ optimalMoves(size) }} moves
          </span>
        </button>
      </div>

      <template v-if="mode === 'solo'">
        <div class="mt-5 rounded-xl border border-base-300 bg-base-200/50 p-4 text-sm">
          <p class="font-semibold">Perfect solve: {{ optimalMoves(disks) }} moves</p>
          <p class="mt-1 opacity-70">
            <template v-if="best">
              Your best on {{ disks }} disks: {{ best.moves }} moves in
              {{ formatDuration(best.ms) }}.
            </template>
            <template v-else
              >No record on {{ disks }} disks yet — your first solve sets it.</template
            >
          </p>
        </div>

        <div class="mt-6 flex flex-col items-stretch gap-2 sm:flex-row">
          <button class="btn btn-soft btn-primary flex-1" @click="start">
            <Icon icon="lucide:play" class="h-4 w-4" />
            Start puzzle
          </button>
          <RouterLink to="/" class="btn btn-ghost flex-1 sm:flex-none">← All games</RouterLink>
        </div>
      </template>

      <template v-else>
        <div class="mt-5 rounded-xl border border-base-300 bg-base-200/50 p-4 text-sm">
          <p class="font-semibold">Race rules</p>
          <ul class="mt-1 list-inside list-disc space-y-0.5 opacity-70">
            <li>Everyone solves the same {{ disks }}-disk puzzle at once.</li>
            <li>First to finish wins; fewer moves and hints break a tie.</li>
            <li>Two or more players, all ready, before the host can start.</li>
          </ul>
        </div>

        <label class="mt-4 block text-sm font-semibold" for="hanoi-host-name">Your name</label>
        <input
          id="hanoi-host-name"
          v-model="hostName"
          type="text"
          maxlength="24"
          placeholder="Your name (you race too)"
          class="input input-bordered mt-2 w-full"
          autocomplete="off"
        />

        <label class="mt-4 block text-sm font-semibold" for="hanoi-max-players">
          Max players
        </label>
        <select
          id="hanoi-max-players"
          v-model.number="maxPlayers"
          class="select select-bordered mt-2 w-full"
        >
          <option v-for="option in PLAYER_OPTIONS" :key="option" :value="option">
            {{ option }} players
          </option>
        </select>

        <div class="mt-6 flex flex-col items-stretch gap-2 sm:flex-row">
          <button class="btn btn-soft btn-primary flex-1" @click="host">
            <Icon icon="lucide:swords" class="h-4 w-4" />
            Host a race
          </button>
          <RouterLink to="/" class="btn btn-ghost flex-1 sm:flex-none">← All games</RouterLink>
        </div>

        <div class="divider text-xs opacity-50">or</div>

        <form class="space-y-2" @submit.prevent="join">
          <p class="text-sm font-semibold">Join a race</p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input
              v-model="joinCode"
              type="text"
              maxlength="6"
              placeholder="Code"
              class="input input-bordered w-full uppercase sm:w-32"
              autocomplete="off"
              aria-label="Room code"
            />
            <input
              v-model="joinName"
              type="text"
              maxlength="24"
              placeholder="Your name"
              class="input input-bordered flex-1"
              autocomplete="off"
              aria-label="Your name"
            />
            <button type="submit" class="btn btn-soft">Join</button>
          </div>
          <p v-if="formError" role="alert" class="text-sm text-error">{{ formError }}</p>
        </form>
      </template>
    </div>
  </section>
</template>
