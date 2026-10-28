<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HanoiScreen from './HanoiScreen.vue'
import HanoiResultScreen from './HanoiResultScreen.vue'
import HanoiSetupScreen from './HanoiSetupScreen.vue'
import HanoiRaceScreen from './HanoiRaceScreen.vue'
import { loadBests, recordSolve, saveBests, type HanoiBest } from './bests'
import {
  clearGameContext,
  clearQuitAction,
  setGameContext,
  setQuitAction,
} from '../../shell/chrome'
import { useHanoiRaceStore } from '../../stores/hanoiRaceStore'

type SoloPhase = 'setup' | 'playing' | 'result'
type ViewMode = 'solo' | 'race'

interface Outcome {
  moves: number
  ms: number
  hintsUsed: number
  best: HanoiBest | null
  isNewBest: boolean
  hadPreviousBest: boolean
}

const route = useRoute()
const router = useRouter()
const store = useHanoiRaceStore()

const view = ref<ViewMode>('solo')
const soloPhase = ref<SoloPhase>('setup')
const disks = ref(4)
const run = ref(0)
const outcome = ref<Outcome | null>(null)
// A join link opens the setup screen with the race tab and code prefilled.
const initialCode = ref('')
const initialMode = ref<ViewMode>('solo')

function start(payload: { disks: number }) {
  disks.value = payload.disks
  run.value += 1
  outcome.value = null
  soloPhase.value = 'playing'
}

function solved(result: { moves: number; ms: number; hintsUsed: number }) {
  const bests = loadBests()
  const hadPreviousBest = Boolean(bests[disks.value])
  const {
    bests: updated,
    best,
    isNewBest,
  } = recordSolve(bests, disks.value, result.moves, result.ms)
  if (isNewBest) saveBests(updated)
  outcome.value = {
    moves: result.moves,
    ms: result.ms,
    hintsUsed: result.hintsUsed,
    best,
    isNewBest,
    hadPreviousBest,
  }
  soloPhase.value = 'result'
}

function backToSetup() {
  outcome.value = null
  soloPhase.value = 'setup'
}

function home() {
  void router.push('/')
}

function hostRace(payload: { disks: number; maxPlayers: number; name: string }) {
  view.value = 'race'
  store.createRoom(payload)
}

function joinRace(payload: { code: string; name: string }) {
  view.value = 'race'
  store.joinRoom(payload.code, payload.name)
}

function leaveRace() {
  store.leave()
  view.value = 'solo'
  soloPhase.value = 'setup'
  initialCode.value = ''
  initialMode.value = 'solo'
}

// A room in the URL is a join link: resume a live race if this browser holds
// one, otherwise open the setup screen prefilled to join.
function enterFromUrl() {
  const room =
    String(route.query.room ?? '')
      .toUpperCase()
      .slice(0, 6) || undefined
  if (!room) return
  if (store.autoResume(room)) {
    view.value = 'race'
  } else {
    initialCode.value = room
    initialMode.value = 'race'
  }
}
enterFromUrl()
watch(() => route.query.room, enterFromUrl)

// The header's quit action only makes sense while there is something to leave.
watch(
  [view, soloPhase, () => store.phase],
  () => {
    if (view.value === 'race' && store.phase !== 'idle' && store.phase !== 'closed') {
      setQuitAction('Leave race', leaveRace)
      setGameContext(store.isHost ? 'Host' : 'Player')
    } else if (view.value === 'solo' && soloPhase.value === 'playing') {
      setQuitAction('Quit puzzle', backToSetup)
      clearGameContext()
    } else {
      clearQuitAction()
      clearGameContext()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  clearQuitAction()
  clearGameContext()
  if (view.value === 'race') store.leave()
})
</script>

<template>
  <HanoiRaceScreen v-if="view === 'race'" @leave="leaveRace" />

  <template v-else>
    <HanoiSetupScreen
      v-if="soloPhase === 'setup'"
      :key="`${initialCode}:${initialMode}`"
      :initial-code="initialCode"
      :initial-mode="initialMode"
      @start="start"
      @host="hostRace"
      @join="joinRace"
    />

    <HanoiScreen v-else-if="soloPhase === 'playing'" :key="run" :disks="disks" @solved="solved" />

    <HanoiResultScreen
      v-else-if="soloPhase === 'result' && outcome"
      :disks="disks"
      :moves="outcome.moves"
      :ms="outcome.ms"
      :hints-used="outcome.hintsUsed"
      :best="outcome.best"
      :is-new-best="outcome.isNewBest"
      :had-previous-best="outcome.hadPreviousBest"
      @replay="start"
      @change-size="backToSetup"
      @home="home"
    />
  </template>
</template>
