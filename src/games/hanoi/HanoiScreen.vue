<script lang="ts" setup>
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { Icon } from '@iconify/vue'
import {
  PEG_COUNT,
  applyMove,
  createBoard,
  hintsAllowed,
  isLegalMove,
  isSolved,
  nextHint,
  optimalMoves,
  remainingMoves,
  topDisk,
  type Board,
  type Move,
} from '../../../shared/hanoiRules.mjs'
import { useStopwatch } from './useStopwatch'
import { isDragGesture, pegAtPoint, type PegRect } from './drag'
import { formatDuration } from './format'
import { diskLiftShadow, diskShadow, diskSurface, diskWidthPercent } from './visuals'

const props = defineProps<{ disks: number }>()

const emit = defineEmits<{
  solved: [result: { moves: number; ms: number; hintsUsed: number }]
}>()

const board = ref<Board>(createBoard(props.disks))
const moves = ref(0)
const hintsUsed = ref(0)
const hint = ref<Move | null>(null)
const shakePeg = ref<number | null>(null)
const pulsePeg = ref<number | null>(null)
/** Something went wrong — shown as an alert next to the board, not in the status line. */
const error = ref('')
/** Neutral feedback (nudges) — the quiet line under the controls. */
const message = ref('')
const narration = ref('')
const solved = ref(false)

// keyboard cursor + the disk in hand (the accessible path; pegs are not clickable)
const cursorPeg = ref(0)
const boardFocused = ref(false)
const held = ref<{ peg: number; disk: number } | null>(null)
/**
 * Which input drove the last action. The keyboard cursor ring is only drawn
 * after real keyboard use, otherwise a stray click leaves a phantom selection
 * ring on the board forever.
 */
const lastInput = ref<'pointer' | 'keyboard'>('pointer')

// pointer drag
const draggingPeg = ref<number | null>(null)
const hoverPeg = ref<number | null>(null)
const ghost = ref<{
  left: number
  top: number
  width: number
  height: number
  disk: number
} | null>(null)
const ghostEl = ref<HTMLElement | null>(null)
const boardRef = ref<HTMLElement | null>(null)
const pegEls = ref<(HTMLElement | null)[]>([])

// non-reactive pointer bookkeeping — nothing here is rendered
let pointer: {
  pointerId: number
  peg: number
  disk: number
  startX: number
  startY: number
  origin: { left: number; top: number; width: number; height: number }
  moved: boolean
} | null = null
let flashTimer: ReturnType<typeof setTimeout> | undefined
let pulseTimer: ReturnType<typeof setTimeout> | undefined
let settleTimer: ReturnType<typeof setTimeout> | undefined
let settleFrame = 0

const { elapsedMs, startOnce, stop, reset } = useStopwatch()

const pegs = Array.from({ length: PEG_COUNT }, (_, index) => index)
const optimal = computed(() => optimalMoves(props.disks))
const remaining = computed(() => remainingMoves(board.value, props.disks))
const hintsTotal = computed(() => hintsAllowed(props.disks))
const hintsLeft = computed(() => Math.max(0, hintsTotal.value - hintsUsed.value))
const statusLine = computed(() => message.value || narration.value)
const cursorVisible = computed(() => lastInput.value === 'keyboard' && boardFocused.value)

/** While a drag is live: which pegs would accept the disk in flight. */
const dragTargets = computed(() => {
  const from = draggingPeg.value
  if (from === null) return null
  const targets: Record<number, boolean> = {}
  for (const peg of pegs) targets[peg] = peg !== from && isLegalMove(board.value, from, peg)
  return targets
})

function isTopDisk(peg: number, index: number) {
  return index === board.value[peg].length - 1
}

function isHeldDisk(peg: number, index: number) {
  return Boolean(held.value && held.value.peg === peg && isTopDisk(peg, index))
}

function diskStyle(disk: number, lifted = false) {
  return {
    width: `${diskWidthPercent(disk, props.disks)}%`,
    backgroundImage: diskSurface(disk, props.disks),
    boxShadow: lifted ? diskLiftShadow() : diskShadow(),
  }
}

function setPegEl(peg: number, el: Element | ComponentPublicInstance | null) {
  pegEls.value[peg] = (el as HTMLElement | null) ?? null
}

function pegRects(): PegRect[] {
  const rects: PegRect[] = []
  pegEls.value.forEach((el, peg) => {
    if (!el) return
    const rect = el.getBoundingClientRect()
    rects.push({ peg, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })
  })
  return rects
}

/**
 * One state language, no dashes: a ring and a filled peg means "drop here", a
 * dimmed peg means "not this one", red means "rejected", and the keyboard cursor
 * is carried by the caret plus a soft ring. Rings rather than borders so the
 * pegs stay free of outlines when idle — they are one board, not three cards.
 */
function pegClass(peg: number) {
  if (shakePeg.value === peg) return 'ring-2 ring-error bg-error/10 hanoi-shake'
  if (pulsePeg.value === peg) return 'ring-2 ring-primary'
  const targets = dragTargets.value
  if (targets) {
    if (peg === draggingPeg.value) return 'ring-1 ring-primary/40'
    return targets[peg] ? 'ring-2 ring-primary bg-primary/5' : 'opacity-50'
  }
  if (held.value && held.value.peg === peg) return 'ring-2 ring-primary'
  if (hint.value && (hint.value.from === peg || hint.value.to === peg)) {
    return 'ring-2 ring-warning'
  }
  if (cursorVisible.value && cursorPeg.value === peg) return 'ring-1 ring-primary/50'
  return ''
}

function diskClass(peg: number, index: number) {
  if (!isTopDisk(peg, index)) return ''
  // the grab area reaches 44px without changing the disk's visual size
  const grabArea = "before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-['']"
  if (draggingPeg.value === peg) return `cursor-grabbing opacity-30 ${grabArea}`
  if (isHeldDisk(peg, index)) {
    return `-translate-y-2 scale-105 ring-2 ring-primary ${grabArea}`
  }
  return `cursor-grab ${grabArea}`
}

function pegSummary(peg: number) {
  const count = board.value[peg].length
  const top = topDisk(board.value, peg)
  if (top === null) return `Peg ${peg + 1} is empty.`
  return `Peg ${peg + 1}: ${count} disk${count === 1 ? '' : 's'}, disk ${top} on top.`
}

function narrateCursor() {
  const parts = [pegSummary(cursorPeg.value)]
  if (held.value) parts.unshift(`Holding disk ${held.value.disk} from peg ${held.value.peg + 1}.`)
  narration.value = parts.join(' ')
}

function flash(peg: number) {
  if (flashTimer !== undefined) clearTimeout(flashTimer)
  shakePeg.value = peg
  flashTimer = setTimeout(() => {
    shakePeg.value = null
    flashTimer = undefined
  }, 520)
}

function pulse(peg: number) {
  if (pulseTimer !== undefined) clearTimeout(pulseTimer)
  pulsePeg.value = peg
  pulseTimer = setTimeout(() => {
    pulsePeg.value = null
    pulseTimer = undefined
  }, 250)
}

function commit(move: Move, { narrate = false }: { narrate?: boolean } = {}) {
  // a completed move definitely counts as play, even if an earlier pickup was
  // the thing that started the clock
  startOnce()
  const disk = topDisk(board.value, move.from)
  board.value = applyMove(board.value, move.from, move.to)
  moves.value += 1
  hint.value = null
  held.value = null
  hoverPeg.value = null
  draggingPeg.value = null
  ghost.value = null
  error.value = ''
  message.value = ''
  // only the keyboard path narrates: a pointer user would lose the narration
  // line to a move report they can already see
  narration.value = narrate
    ? `Disk ${disk} moved to peg ${move.to + 1}. ${pegSummary(move.to)}`
    : ''
  if (isSolved(board.value, props.disks)) {
    solved.value = true
    emit('solved', { moves: moves.value, ms: stop(), hintsUsed: hintsUsed.value })
  }
}

// --- pointer drag ---------------------------------------------------------

function onDiskPointerDown(event: PointerEvent, peg: number, index: number) {
  if (solved.value || !event.isPrimary) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  lastInput.value = 'pointer'
  if (index !== board.value[peg].length - 1) {
    error.value = 'Only the top disk of a peg can move.'
    return
  }
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  // a settle animation from the previous drop must not clear this new ghost
  if (settleTimer !== undefined) {
    clearTimeout(settleTimer)
    settleTimer = undefined
  }
  if (settleFrame) {
    cancelAnimationFrame(settleFrame)
    settleFrame = 0
  }
  ghost.value = null
  pointer = {
    pointerId: event.pointerId,
    peg,
    disk: board.value[peg][index],
    startX: event.clientX,
    startY: event.clientY,
    origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    moved: false,
  }
  try {
    el.setPointerCapture(event.pointerId)
  } catch {
    // the pointer can already be gone; the window-level listeners still drive
    // the drag, so losing capture only costs us events outside the element
  }
  // a drag supersedes whatever the keyboard was holding
  held.value = null
  error.value = ''
  message.value = ''
  narration.value = ''
  hint.value = null
  hoverPeg.value = peg
}

/**
 * The ghost's position is written straight to the node instead of through a
 * reactive style, so pointermove never waits on a component re-render.
 */
function applyGhostTransform(dx: number, dy: number) {
  if (ghostEl.value) ghostEl.value.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
}

function onPointerMove(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.pointerId) return
  const dx = event.clientX - pointer.startX
  const dy = event.clientY - pointer.startY
  if (!pointer.moved) {
    if (!isDragGesture(pointer.startX, pointer.startY, event.clientX, event.clientY)) return
    pointer.moved = true
    draggingPeg.value = pointer.peg
    // a disk is now in hand, so the solve is under way
    startOnce()
    ghost.value = { ...pointer.origin, disk: pointer.disk }
    void nextTick(() => applyGhostTransform(dx, dy))
  } else {
    applyGhostTransform(dx, dy)
  }
  hoverPeg.value = pegAtPoint(pegRects(), event.clientX, event.clientY)
}

function onPointerUp(event: PointerEvent) {
  if (!pointer || event.pointerId !== pointer.pointerId) return
  const active = pointer
  if (!active.moved) {
    // a motionless tap moves nothing — nudge towards dragging instead
    finishDrag()
    pulse(active.peg)
    message.value = 'Hold and drag the disk onto another peg to move it.'
    return
  }
  dropOnto(active.peg, pegAtPoint(pegRects(), event.clientX, event.clientY))
}

function dropOnto(from: number, target: number | null) {
  // released on the same peg or clearly away from the board — put it back
  if (target === null || target === from) {
    finishDrag()
    settleBack()
    return
  }
  if (!isLegalMove(board.value, from, target)) {
    flash(target)
    error.value = 'A larger disk can never sit on a smaller one.'
    finishDrag()
    settleBack()
    return
  }
  finishDrag()
  commit({ from, to: target })
}

/** Eases the ghost back to where the disk came from, then removes it. */
function settleBack() {
  const el = ghostEl.value
  if (!ghost.value || !el) {
    ghost.value = null
    return
  }
  el.classList.add('hanoi-settle')
  if (settleTimer !== undefined) clearTimeout(settleTimer)
  if (settleFrame) cancelAnimationFrame(settleFrame)
  // let the transition land on the element first, then move it, or the browser
  // has no style-change frame to animate from
  settleFrame = requestAnimationFrame(() => {
    settleFrame = 0
    applyGhostTransform(0, 0)
  })
  settleTimer = setTimeout(() => {
    ghost.value = null
    settleTimer = undefined
  }, 220)
}

function finishDrag() {
  pointer = null
  draggingPeg.value = null
  hoverPeg.value = null
}

function cancelPointerDrag() {
  if (!pointer) return
  finishDrag()
  settleBack()
}

function onPointerCancel(event: PointerEvent) {
  if (pointer && event.pointerId === pointer.pointerId) cancelPointerDrag()
}

// fires after a normal release too — only interrupt a drag that never ended
function onLostPointerCapture() {
  if (pointer) cancelPointerDrag()
}

// --- keyboard -------------------------------------------------------------

function moveCursor(delta: number) {
  lastInput.value = 'keyboard'
  // these handlers only run from the board itself, so it is focused — setting
  // this explicitly survives a re-focus where no focus event is fired
  boardFocused.value = true
  cursorPeg.value = (cursorPeg.value + delta + PEG_COUNT) % PEG_COUNT
  error.value = ''
  message.value = ''
  narrateCursor()
}

function moveCursorTo(peg: number) {
  lastInput.value = 'keyboard'
  cursorPeg.value = peg
  error.value = ''
  message.value = ''
  narrateCursor()
  boardRef.value?.focus()
}

function activatePeg(peg: number) {
  if (solved.value) return
  lastInput.value = 'keyboard'
  boardFocused.value = true
  error.value = ''
  message.value = ''
  if (!held.value) {
    const disk = topDisk(board.value, peg)
    if (disk === null) {
      error.value = `Peg ${peg + 1} is empty — nothing to pick up.`
      return
    }
    held.value = { peg, disk }
    // the disk is in hand: start the clock rather than counting page-idle time
    startOnce()
    narration.value = `Disk ${disk} picked up from peg ${peg + 1}. Choose a peg with the arrow keys, then press Space to drop it, or Escape to cancel.`
    return
  }
  if (held.value.peg === peg) {
    held.value = null
    narration.value = 'Put back. ' + pegSummary(peg)
    return
  }
  if (!isLegalMove(board.value, held.value.peg, peg)) {
    flash(peg)
    // keep the disk in hand so the next peg can be tried straight away
    error.value = `Disk ${held.value.disk} cannot sit on a smaller disk. Choose another peg, or press Escape to cancel.`
    return
  }
  commit({ from: held.value.peg, to: peg }, { narrate: true })
}

function onBoardKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    moveCursor(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    moveCursor(1)
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    activatePeg(cursorPeg.value)
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'h') showHint()
  else if (key === 'r') restart()
  else if (key === '1' || key === '2' || key === '3') {
    event.preventDefault()
    moveCursorTo(Number(key) - 1)
  } else if (event.key === 'Escape') {
    if (pointer) {
      cancelPointerDrag()
    } else if (held.value) {
      held.value = null
      error.value = ''
      message.value = ''
      narration.value = 'Cancelled. ' + pegSummary(cursorPeg.value)
    }
  }
}

function showHint() {
  if (hintsLeft.value === 0) return
  const move = nextHint(board.value, props.disks)
  if (!move) return
  hint.value = move
  hintsUsed.value += 1
}

function restart() {
  cancelPointerDrag()
  board.value = createBoard(props.disks)
  held.value = null
  cursorPeg.value = 0
  moves.value = 0
  hintsUsed.value = 0
  hint.value = null
  error.value = ''
  message.value = ''
  narration.value = ''
  solved.value = false
  // clock back to zero and idle again until the next pickup or move
  reset()
}

watch(
  () => props.disks,
  () => restart(),
)

onMounted(() => {
  // the clock stays idle until the first pickup or move
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('lostpointercapture', onLostPointerCapture)
  window.addEventListener('blur', cancelPointerDrag)
  window.addEventListener('scroll', cancelPointerDrag, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('lostpointercapture', onLostPointerCapture)
  window.removeEventListener('blur', cancelPointerDrag)
  window.removeEventListener('scroll', cancelPointerDrag)
  if (flashTimer !== undefined) clearTimeout(flashTimer)
  if (pulseTimer !== undefined) clearTimeout(pulseTimer)
  if (settleTimer !== undefined) clearTimeout(settleTimer)
  if (settleFrame) cancelAnimationFrame(settleFrame)
})
</script>

<template>
  <div class="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-0 lg:max-w-5xl">
    <div class="stats stats-vertical w-full bg-base-200 shadow sm:stats-horizontal">
      <div class="stat">
        <div class="stat-title">Moves</div>
        <div class="stat-value text-3xl text-primary tabular-nums">{{ moves }}</div>
        <div class="stat-desc">{{ optimal }} is perfect</div>
      </div>
      <div class="stat">
        <div class="stat-title">Time</div>
        <div class="stat-value text-3xl tabular-nums">{{ formatDuration(elapsedMs) }}</div>
        <div class="stat-desc">{{ disks }} disks</div>
      </div>
      <div class="stat">
        <div class="stat-title">Still needed</div>
        <div class="stat-value text-3xl tabular-nums">{{ remaining }}</div>
        <div class="stat-desc">moves for a perfect finish</div>
      </div>
    </div>

    <div
      ref="boardRef"
      role="application"
      tabindex="0"
      aria-label="Tower of Hanoi board. Use the left and right arrow keys to choose a peg, then Space to pick up or drop the top disk."
      class="relative grid grid-cols-3 gap-2 rounded-2xl bg-base-100 p-2 shadow outline-none focus-visible:ring-2 focus-visible:ring-primary sm:gap-4 sm:p-4"
      @keydown="onBoardKeydown"
      @focus="boardFocused = true"
      @blur="boardFocused = false"
    >
      <div
        v-for="peg in pegs"
        :key="peg"
        :ref="(el) => setPegEl(peg, el)"
        class="relative flex h-64 flex-col-reverse items-center justify-start rounded-xl bg-base-200/40 pb-5 pt-6 transition sm:h-80 lg:h-[26rem]"
        :class="pegClass(peg)"
      >
        <span
          class="hanoi-rod absolute bottom-5 top-6 w-3 rounded-t-full sm:w-4"
          aria-hidden="true"
        ></span>
        <span
          v-for="(disk, index) in board[peg]"
          :key="disk"
          class="relative z-30 h-6 shrink-0 touch-none select-none rounded-full transition-transform [-webkit-touch-callout:none] [-webkit-user-drag:none] sm:h-8"
          :class="diskClass(peg, index)"
          :style="diskStyle(disk, isHeldDisk(peg, index))"
          aria-hidden="true"
          @pointerdown="onDiskPointerDown($event, peg, index)"
        ></span>
        <!-- keyboard cursor: a caret where the peg label used to be -->
        <span
          v-if="cursorVisible && cursorPeg === peg"
          class="absolute top-1.5 h-1.5 w-8 rounded-full bg-primary"
          aria-hidden="true"
        ></span>
      </div>

      <!-- one continuous wooden base the pegs are mounted on, like a real board.
           h-3 lands its top exactly on the line the disks rest on (card padding,
           now that the pegs carry no border). -->
      <span
        class="hanoi-base absolute inset-x-2 bottom-4 z-20 h-3 rounded-md sm:inset-x-4 sm:bottom-6"
        aria-hidden="true"
      ></span>
    </div>

    <p v-if="error" role="alert" class="alert alert-error py-2 text-sm">
      <Icon icon="lucide:triangle-alert" class="h-4 w-4 shrink-0" />
      <span>{{ error }}</span>
    </p>

    <!-- the hint is a notification, not a line of text: it is the answer to a
         deliberate request, so it has to be impossible to miss. role=status so
         it is also announced — the button press is otherwise silent. -->
    <div
      v-else-if="hint"
      role="status"
      class="hanoi-notify alert alert-info py-2 text-sm shadow-lg"
    >
      <Icon icon="lucide:lightbulb" class="h-4 w-4 shrink-0" />
      <span>
        Move the top disk from peg <strong>{{ hint.from + 1 }}</strong> to peg
        <strong>{{ hint.to + 1 }}</strong
        >.
      </span>
      <span
        class="badge badge-sm gap-2 whitespace-nowrap border-info-content/25 bg-info-content/10 font-semibold text-info-content"
      >
        <!-- depletion gauge: filled dots are the hints still available. Kept at
             full content colour so the dots, not the chip, carry the contrast.
             Hidden on phones, where the count alone has to carry it. -->
        <span class="hidden items-center gap-1 sm:flex" aria-hidden="true">
          <span
            v-for="slot in hintsTotal"
            :key="slot"
            class="h-2 w-2 rounded-full"
            :class="slot <= hintsLeft ? 'bg-info-content' : 'bg-info-content/30'"
          />
        </span>
        <span class="sr-only">{{ hintsLeft }} of {{ hintsTotal }} hints left</span>
        <span class="tabular-nums" aria-hidden="true">{{ hintsLeft }} left</span>
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        class="btn btn-soft btn-warning"
        :disabled="hintsLeft === 0"
        :title="hintsLeft === 0 ? 'No hints left for this puzzle' : `${hintsLeft} left`"
        @click="showHint"
      >
        <Icon icon="lucide:lightbulb" class="h-4 w-4" />
        {{ hintsLeft === 0 ? 'No hints left' : `Hint (${hintsLeft})` }}
      </button>
      <button class="btn btn-ghost" @click="restart">
        <Icon icon="lucide:rotate-ccw" class="h-4 w-4" />
        Restart
      </button>
    </div>

    <p role="status" aria-live="polite" class="min-h-5 text-sm opacity-70">
      {{ statusLine }}
    </p>

    <!-- persistent controls reference, below the board so it never competes -->
    <section class="rounded-xl bg-base-200/50 p-4">
      <h2 class="text-sm font-semibold">Controls</h2>
      <dl class="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div class="flex items-center gap-3">
          <dt class="flex shrink-0 gap-1">
            <kbd class="kbd kbd-sm">←</kbd><kbd class="kbd kbd-sm">→</kbd>
          </dt>
          <dd class="opacity-75">Move between pegs</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="flex shrink-0 gap-1">
            <kbd class="kbd kbd-sm">1</kbd><kbd class="kbd kbd-sm">2</kbd
            ><kbd class="kbd kbd-sm">3</kbd>
          </dt>
          <dd class="opacity-75">Jump straight to a peg</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="flex shrink-0 gap-1">
            <kbd class="kbd kbd-sm">Space</kbd><span class="opacity-50">/</span
            ><kbd class="kbd kbd-sm">Enter</kbd>
          </dt>
          <dd class="opacity-75">Pick up the top disk, then drop it</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="shrink-0"><kbd class="kbd kbd-sm">Esc</kbd></dt>
          <dd class="opacity-75">Put a picked-up disk back</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="shrink-0"><kbd class="kbd kbd-sm">H</kbd></dt>
          <dd class="opacity-75">Reveal the next optimal move</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="shrink-0"><kbd class="kbd kbd-sm">R</kbd></dt>
          <dd class="opacity-75">Start this puzzle over</dd>
        </div>
        <div class="flex items-center gap-3">
          <dt class="flex shrink-0 items-center gap-1">
            <Icon icon="lucide:mouse-pointer-click" class="h-4 w-4 opacity-70" />
          </dt>
          <dd class="opacity-75">Drag the top disk onto another peg</dd>
        </div>
      </dl>
    </section>
  </div>

  <!-- follows the pointer while dragging; fixed so the stack never reflows.
       Scaled and glowing so the disk in hand is unmistakable. -->
  <div
    v-if="ghost"
    ref="ghostEl"
    class="hanoi-lift pointer-events-none fixed z-50 rounded-full"
    :style="{
      left: `${ghost.left}px`,
      top: `${ghost.top}px`,
      width: `${ghost.width}px`,
      height: `${ghost.height}px`,
      backgroundImage: diskSurface(ghost.disk, disks),
      boxShadow: diskLiftShadow(),
    }"
    aria-hidden="true"
  ></div>
</template>

<style scoped>
/* Turned wooden dowel: fixed browns, shaded across the width so it reads as a
   cylinder. Deliberately not a theme token — wood is wood in every theme. */
.hanoi-rod {
  background-image: linear-gradient(
    90deg,
    #6b3f1d 0%,
    #a9713a 35%,
    #c9955a 52%,
    #976230 75%,
    #6b3f1d 100%
  );
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.25);
}

/* The plinth is lit from above rather than across, so it reads as a flat base. */
.hanoi-base {
  background-image: linear-gradient(180deg, #b07a45 0%, #8a5527 45%, #5f3818 100%);
  box-shadow: 0 2px 6px rgb(0 0 0 / 0.3);
}

/* Picking a disk up grows it slightly. `scale` is its own property, so the
   translate that follows the pointer stays untransitioned and instant. */
.hanoi-lift {
  scale: 1.04;
}

/* A hint is the answer to a deliberate request, so it drops in rather than
   appearing silently. */
.hanoi-notify {
  animation: hanoi-notify 0.2s ease-out 1;
}

@keyframes hanoi-notify {
  from {
    opacity: 0;
    transform: translateY(-5px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hanoi-shake {
  animation: hanoi-shake 0.52s ease-in-out 1;
}

@keyframes hanoi-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-8px);
  }
  50% {
    transform: translateX(7px);
  }
  80% {
    transform: translateX(-4px);
  }
}

.hanoi-pulse {
  animation: hanoi-pulse 0.25s ease-in-out 1;
}

@keyframes hanoi-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.03);
  }
}

.hanoi-settle {
  transition: transform 0.2s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .hanoi-shake,
  .hanoi-pulse,
  .hanoi-notify {
    animation: none;
  }

  .hanoi-settle {
    transition: none;
  }
}
</style>
