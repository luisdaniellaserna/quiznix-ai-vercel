<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { cellAtPoint, isDragGesture, pointInRect, type CellRect } from './drag'
import {
  boxSize,
  cellCount,
  cellPeers,
  clearCellNotes,
  columnOf,
  digits,
  emptyNotes,
  findConflicts,
  isSolved,
  prunePeerNotes,
  rowOf,
  toggleNote,
  units,
  type Grid,
  type Notes,
} from './rules'
import type { Puzzle } from './generator'
import { useStopwatch } from '../../composables/useStopwatch'
import { formatDuration } from '../shared/format'

const props = defineProps<{ puzzle: Puzzle }>()

const emit = defineEmits<{
  solved: [result: { ms: number; hintsUsed: number }]
}>()

const HINTS_ALLOWED = 3

// the flow re-mounts this component per run, so the puzzle is fixed for its life
const size = props.puzzle.size
const box = boxSize(size)
const solution = props.puzzle.solution
const givens = props.puzzle.givens

const grid = ref<Grid>(givens.slice())
const notes = ref<Notes>(emptyNotes(size))
const selected = ref<number | null>(null)
const notesMode = ref(false)
const hintsUsed = ref(0)
const message = ref('')
const narration = ref('')
const finished = ref(false)
const boardRef = ref<HTMLElement | null>(null)

/**
 * A press on a digit is ambiguous until the pointer moves: under the threshold it
 * is a tap for the selected cell, over it becomes a drag onto any cell. Rect
 * measurements are taken when the drag starts, so a drop never has to re-layout.
 */
const drag = ref<{
  pointerId: number
  digit: number
  startX: number
  startY: number
  x: number
  y: number
  active: boolean
  rects: CellRect[]
  pad: { left: number; top: number; right: number; bottom: number }
} | null>(null)
const hoverIndex = ref<number | null>(null)

const { elapsedMs, startOnce, stop } = useStopwatch()

const boxUnits = units(size).slice(size * 2)
const digitsInPlay = digits(size)
const total = cellCount(size)

const conflictCells = computed(() => findConflicts(grid.value, size))
const peerCells = computed(
  () => new Set(selected.value === null ? [] : cellPeers(size, selected.value)),
)
const selectedDigit = computed(() => (selected.value === null ? 0 : grid.value[selected.value]))
const filled = computed(() => grid.value.reduce((count, value) => count + (value > 0 ? 1 : 0), 0))
const hintsLeft = computed(() => Math.max(0, HINTS_ALLOWED - hintsUsed.value))
const boardWidth = size === 4 ? 'max-w-xs' : 'max-w-md'
const digitText = size === 4 ? 'text-2xl sm:text-3xl' : 'text-[1.05rem] sm:text-2xl'
const noteText = size === 4 ? 'text-[9px] sm:text-[11px]' : 'text-[7px] sm:text-[9px]'

/** The cell under a digit in flight, and whether it would accept it. */
const dropTarget = computed(() => {
  const state = drag.value
  const index = hoverIndex.value
  if (!state?.active || index === null) return null
  const blocked = Boolean(givens[index]) || (notesMode.value && grid.value[index] > 0)
  return { index, valid: !blocked }
})

/** How many of each digit are already on the board. */
const digitUses = computed(() => {
  const uses = new Map<number, number>()
  for (const value of grid.value) {
    if (!value) continue
    uses.set(value, (uses.get(value) ?? 0) + 1)
  }
  return uses
})

function remaining(digit: number): number {
  return size - (digitUses.value.get(digit) ?? 0)
}

/**
 * What the held digit would become in this cell, so a drag can be previewed at
 * the target instead of only under the pointer.
 */
function preview(index: number): { digit: number; mode: 'value' | 'note' } | null {
  const target = dropTarget.value
  const state = drag.value
  if (!target || !state || target.index !== index || !target.valid) return null
  return { digit: state.digit, mode: notesMode.value ? 'note' : 'value' }
}

/**
 * One background per cell rather than stacked utilities: the selection wins,
 * then a conflict, then the digit that is also selected, then its peers.
 */
function surface(index: number): string {
  if (index === selected.value) return 'bg-primary/20'
  if (conflictCells.value.has(index)) return 'bg-error/15'
  if (selectedDigit.value > 0 && grid.value[index] === selectedDigit.value) return 'bg-secondary/15'
  if (peerCells.value.has(index)) return 'bg-primary/5'
  return 'bg-base-100'
}

function textTone(index: number): string {
  if (conflictCells.value.has(index)) return 'text-error'
  return givens[index] ? 'text-base-content' : 'text-primary'
}

function dropRing(index: number): string {
  const target = dropTarget.value
  if (!target || target.index !== index) return ''
  return target.valid ? 'ring-2 ring-inset ring-primary/70' : 'ring-2 ring-inset ring-error/70'
}

function noteOpacity(index: number, digit: number): string {
  const ghost = preview(index)
  if (ghost?.mode === 'note' && ghost.digit === digit) return 'opacity-40'
  return notes.value[index].includes(digit) ? 'opacity-70' : 'opacity-0'
}

function showsNotes(index: number): boolean {
  return notes.value[index].length > 0 || preview(index)?.mode === 'note'
}

function cellLabel(index: number): string {
  const where = `Row ${rowOf(size, index) + 1}, column ${columnOf(size, index) + 1}`
  const value = grid.value[index]
  if (value) return `${where}, ${value}${givens[index] ? ', clue' : ''}`
  const marks = notes.value[index]
  return marks.length ? `${where}, empty, notes ${marks.join(' ')}` : `${where}, empty`
}

function announceSelection(index: number) {
  narration.value = cellLabel(index)
}

function select(index: number) {
  if (finished.value || drag.value?.active) return
  selected.value = index
  boardRef.value?.focus({ preventScroll: true })
  announceSelection(index)
}

/** The single place a digit lands, whether it was tapped, dropped or hinted. */
function applyDigit(index: number, digit: number) {
  if (finished.value) return
  selected.value = index

  if (givens[index]) {
    message.value = 'That number is a clue and cannot be changed.'
    return
  }

  if (notesMode.value) {
    if (grid.value[index]) {
      message.value = 'Erase the cell before adding pencil marks.'
      return
    }
    startOnce()
    notes.value = toggleNote(notes.value, index, digit)
    message.value = ''
    narration.value = `${digit} ${notes.value[index].includes(digit) ? 'noted' : 'unnoted'}. ${cellLabel(index)}.`
    return
  }

  // pressing the digit already in the cell takes it back out
  if (grid.value[index] === digit) {
    eraseAt(index)
    return
  }

  startOnce()
  grid.value[index] = digit
  notes.value = clearCellNotes(prunePeerNotes(notes.value, size, index, digit), index)
  message.value = conflictCells.value.has(index)
    ? 'That digit already appears in this row, column or box.'
    : ''
  narration.value = `${digit} placed. ${cellLabel(index)}.`

  if (isSolved(grid.value, size)) finish()
}

function place(digit: number) {
  if (finished.value) return
  const index = selected.value
  if (index === null) {
    message.value = 'Pick a cell first, then choose a digit.'
    return
  }
  applyDigit(index, digit)
}

function eraseAt(index: number) {
  if (finished.value) return
  if (givens[index]) {
    message.value = 'That number is a clue and cannot be changed.'
    return
  }
  grid.value[index] = 0
  notes.value = clearCellNotes(notes.value, index)
  message.value = ''
  narration.value = `Cleared. ${cellLabel(index)}.`
}

function erase() {
  if (selected.value === null) return
  eraseAt(selected.value)
}

/** Prefers the selected cell when it is empty or wrong, then the first mismatch. */
function hintIndex(): number | null {
  const index = selected.value
  if (index !== null && grid.value[index] !== solution[index]) return index
  const found = grid.value.findIndex((value, at) => value !== solution[at])
  return found === -1 ? null : found
}

function useHint() {
  if (finished.value || hintsLeft.value === 0) return
  const index = hintIndex()
  if (index === null) return

  startOnce()
  const digit = solution[index]
  grid.value[index] = digit
  notes.value = clearCellNotes(prunePeerNotes(notes.value, size, index, digit), index)
  hintsUsed.value += 1
  selected.value = index
  message.value = `Hint: row ${rowOf(size, index) + 1}, column ${columnOf(size, index) + 1} is ${digit}.`
  narration.value = message.value

  if (isSolved(grid.value, size)) finish()
}

function finish() {
  if (finished.value) return
  finished.value = true
  const ms = stop()
  message.value = 'Solved!'
  emit('solved', { ms, hintsUsed: hintsUsed.value })
}

function moveSelection(deltaRow: number, deltaColumn: number) {
  const current = selected.value
  if (current === null) {
    select(0)
    return
  }
  const row = Math.min(size - 1, Math.max(0, rowOf(size, current) + deltaRow))
  const column = Math.min(size - 1, Math.max(0, columnOf(size, current) + deltaColumn))
  select(row * size + column)
}

// --- digit drag -------------------------------------------------------------

function boardCellRects(): CellRect[] {
  const board = boardRef.value
  if (!board) return []
  return Array.from(board.querySelectorAll<HTMLElement>('[data-cell]')).map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      index: Number(element.dataset.cell),
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    }
  })
}

function onPadPointerDown(event: PointerEvent, digit: number) {
  if (finished.value || !event.isPrimary || event.button !== 0) return
  const pad = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  drag.value = {
    pointerId: event.pointerId,
    digit,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    active: false,
    rects: [],
    pad: pad
      ? { left: pad.left, top: pad.top, right: pad.right, bottom: pad.bottom }
      : { left: 0, top: 0, right: 0, bottom: 0 },
  }
}

function onPointerMove(event: PointerEvent) {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return

  // a release the page never saw (outside the window) would leave this armed, so
  // hover movement with no button down cancels it
  if (event.pointerType === 'mouse' && event.buttons === 0) {
    cancelDrag()
    return
  }

  state.x = event.clientX
  state.y = event.clientY

  if (!state.active) {
    if (!isDragGesture(state.startX, state.startY, event.clientX, event.clientY)) return
    state.active = true
    state.rects = boardCellRects()
    narration.value = `Dragging ${state.digit}. Release over a cell to place it.`
  }

  const next = cellAtPoint(state.rects, event.clientX, event.clientY)
  if (next !== hoverIndex.value) hoverIndex.value = next
}

function onPointerUp(event: PointerEvent) {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return

  drag.value = null
  hoverIndex.value = null

  // never moved far enough: the press was a tap for the selected cell
  if (!state.active) {
    place(state.digit)
    return
  }

  const index = cellAtPoint(state.rects, event.clientX, event.clientY)
  if (index !== null) {
    applyDigit(index, state.digit)
    return
  }

  // a wobble that never left the digit it started on is still a tap
  if (pointInRect(state.pad, event.clientX, event.clientY)) {
    place(state.digit)
    return
  }

  narration.value = 'Drag cancelled.'
}

function cancelDrag() {
  if (!drag.value) return
  drag.value = null
  hoverIndex.value = null
  narration.value = 'Drag cancelled.'
}

function onPointerCancel(event: PointerEvent) {
  const state = drag.value
  if (!state || event.pointerId !== state.pointerId) return
  cancelDrag()
}

/**
 * Pointer taps are already resolved on pointerup; this path is for keyboard and
 * assistive-technology activation, which arrive as a click with no click count.
 */
function onDigitClick(digit: number, event: MouseEvent) {
  if (event.detail !== 0) return
  place(digit)
}

// --- keyboard ---------------------------------------------------------------

function onKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const { key } = event

  const arrows: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  }
  const move = arrows[key]
  if (move) {
    event.preventDefault()
    moveSelection(move[0], move[1])
    return
  }

  if (key === 'Backspace' || key === 'Delete' || key === '0') {
    event.preventDefault()
    erase()
    return
  }
  if (key === 'n' || key === 'N') {
    event.preventDefault()
    notesMode.value = !notesMode.value
    return
  }
  if (key === 'h' || key === 'H') {
    event.preventDefault()
    useHint()
    return
  }

  const digit = Number(key)
  if (Number.isInteger(digit) && digit >= 1 && digit <= size) {
    event.preventDefault()
    place(digit)
  }
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('blur', cancelDrag)
  boardRef.value?.focus({ preventScroll: true })
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('blur', cancelDrag)
})
</script>

<template>
  <div
    class="app-container w-full max-w-3xl space-y-4 py-8 sm:py-10 lg:max-w-5xl"
    @keydown="onKeydown"
  >
    <div class="stats stats-vertical border-base-300 w-full border sm:stats-horizontal">
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Time</div>
        <div class="stat-value pixel-number text-2xl">{{ formatDuration(elapsedMs) }}</div>
        <div class="stat-desc">{{ size }}×{{ size }} board</div>
      </div>
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Filled</div>
        <div class="stat-value pixel-number text-primary text-2xl">{{ filled }}/{{ total }}</div>
        <div class="stat-desc">{{ total - filled }} cells to go</div>
      </div>
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Hints</div>
        <div class="stat-value pixel-number text-2xl">{{ hintsLeft }}</div>
        <div class="stat-desc">of {{ HINTS_ALLOWED }} left</div>
      </div>
    </div>

    <div
      ref="boardRef"
      role="application"
      tabindex="0"
      :aria-label="`Sudoku board, ${size} by ${size}. Pick a cell and choose a digit, or drag a digit from the pad onto a cell. Arrow keys choose a cell, number keys fill it, Backspace erases, N for pencil marks and H for a hint.`"
      class="border-base-300 bg-base-300 mx-auto w-full rounded-[var(--radius-box)] border p-[3px] outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="[boardWidth, drag?.active ? 'pointer-events-none' : '']"
    >
      <div
        class="grid gap-[3px]"
        :style="{ gridTemplateColumns: `repeat(${box}, minmax(0, 1fr))` }"
      >
        <div
          v-for="(unit, boxIndex) in boxUnits"
          :key="boxIndex"
          class="grid gap-px"
          :style="{ gridTemplateColumns: `repeat(${box}, minmax(0, 1fr))` }"
        >
          <button
            v-for="index in unit"
            :key="index"
            type="button"
            tabindex="-1"
            :data-cell="index"
            :aria-label="cellLabel(index)"
            class="relative flex aspect-square cursor-pointer touch-manipulation items-center justify-center transition-colors duration-150 select-none focus:outline-none motion-reduce:transition-none"
            :class="[surface(index), textTone(index), dropRing(index)]"
            @click="select(index)"
          >
            <span
              v-if="preview(index)?.mode === 'value'"
              class="font-mono tabular-nums opacity-40"
              :class="digitText"
            >
              {{ preview(index)?.digit }}
            </span>
            <span
              v-else-if="grid[index]"
              class="font-mono tabular-nums"
              :class="[digitText, givens[index] ? 'font-semibold' : '']"
            >
              {{ grid[index] }}
            </span>
            <span
              v-else-if="showsNotes(index)"
              class="absolute inset-0 grid p-0.5"
              :style="{ gridTemplateColumns: `repeat(${box}, minmax(0, 1fr))` }"
              aria-hidden="true"
            >
              <span
                v-for="digit in digitsInPlay"
                :key="digit"
                class="flex items-center justify-center font-mono leading-none"
                :class="[noteText, noteOpacity(index, digit)]"
              >
                {{ digit }}
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <p
      v-if="message"
      class="alert alert-soft justify-center py-2 text-center text-sm"
      role="status"
    >
      {{ message }}
    </p>

    <div class="mx-auto w-full space-y-3" :class="boardWidth">
      <div
        class="grid gap-1.5"
        :style="{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }"
        role="group"
        aria-label="Digits"
      >
        <button
          v-for="digit in digitsInPlay"
          :key="digit"
          type="button"
          class="border-base-300 bg-base-100 flex touch-none cursor-grab flex-col items-center justify-center rounded-md border py-2 transition duration-200 select-none hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none"
          :class="drag?.digit === digit && drag.active ? 'border-primary/70 opacity-60' : ''"
          :disabled="remaining(digit) === 0"
          :aria-label="`${digit}, ${remaining(digit)} left — tap or drag`"
          @pointerdown="onPadPointerDown($event, digit)"
          @click="onDigitClick(digit, $event)"
        >
          <span class="font-mono text-lg leading-none font-semibold">{{ digit }}</span>
          <span class="mt-1 font-mono text-[9px] leading-none opacity-50">{{
            remaining(digit)
          }}</span>
        </button>
      </div>

      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-sm flex-1"
          :class="notesMode ? 'btn-primary' : 'btn-outline border-base-300'"
          :aria-pressed="notesMode"
          @click="notesMode = !notesMode"
        >
          <Icon icon="lucide:pencil" class="h-4 w-4" aria-hidden="true" />
          Notes
        </button>
        <button
          type="button"
          class="btn btn-outline border-base-300 btn-sm flex-1"
          :disabled="selected === null || Boolean(selected !== null && givens[selected])"
          @click="erase"
        >
          <Icon icon="lucide:eraser" class="h-4 w-4" aria-hidden="true" />
          Erase
        </button>
        <button
          type="button"
          class="btn btn-outline border-base-300 btn-sm flex-1"
          :disabled="hintsLeft === 0"
          @click="useHint"
        >
          <Icon icon="lucide:lightbulb" class="h-4 w-4" aria-hidden="true" />
          Hint
        </button>
      </div>

      <p class="text-center font-mono text-[10px] tracking-[0.16em] uppercase opacity-50">
        Tap or drag a digit · arrows move · N notes · H hint
      </p>
    </div>

    <p class="sr-only" aria-live="polite">{{ narration }}</p>

    <!-- the held digit, so the pointer always has something under it -->
    <Teleport to="body">
      <div
        v-if="drag?.active"
        class="border-primary/60 bg-base-100 text-primary pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-md border px-3 py-2 font-mono text-lg leading-none font-semibold opacity-80 shadow-lg"
        :style="{ left: `${drag.x}px`, top: `${drag.y}px` }"
        aria-hidden="true"
      >
        {{ drag.digit }}
      </div>
    </Teleport>
  </div>
</template>
