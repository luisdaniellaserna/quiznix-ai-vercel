<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue'

const emit = defineEmits(['store-answer', 'end-quiz', 'previous', 'quit-quiz'])

const props = defineProps<{
  questions: QuestionFormat[]
  duration: number
  timed: boolean
}>()

const currentQuestion = ref(0)
const selectedOption = ref<string | null>(null)
const remaining = ref(props.duration)
const selections = ref<(string | null)[]>([])
// per-question countdown snapshots so Back resumes a question's remaining time
const remainingByIndex = ref<(number | undefined)[]>([])
let timerId: ReturnType<typeof setInterval> | undefined

const shuffleOptions = computed(() => {
  const question = props.questions?.[currentQuestion.value]
  if (!question) return []
  const options = [...question.incorrect_answers]
  const randomIndex = Math.round(Math.random() * options.length)
  options.splice(randomIndex, 0, question.correct_answer)
  return options
})

function clearTimer() {
  if (timerId !== undefined) {
    clearInterval(timerId)
    timerId = undefined
  }
}

function startTimer() {
  clearTimer()
  remaining.value = remainingByIndex.value[currentQuestion.value] ?? props.duration
  timerId = setInterval(() => {
    remaining.value -= 1
    remainingByIndex.value[currentQuestion.value] = remaining.value
    if (remaining.value <= 0) {
      clearTimer()
      submitAnswer()
    }
  }, 1000)
}

function submitAnswer() {
  clearTimer()
  selections.value[currentQuestion.value] = selectedOption.value
  emit('store-answer', {
    question: props.questions[currentQuestion.value],
    answer: selectedOption.value,
  })

  if (currentQuestion.value === props.questions.length - 1) {
    emit('end-quiz')
    return
  }

  currentQuestion.value += 1
  selectedOption.value = selections.value[currentQuestion.value] ?? null
}

function goBack() {
  if (currentQuestion.value === 0) return
  clearTimer()
  emit('previous')
  currentQuestion.value -= 1
  selectedOption.value = selections.value[currentQuestion.value] ?? null
}

// a timed-out question is locked — going back to it would let the player re-answer it
const canGoBack = computed(() => {
  if (currentQuestion.value === 0) return false
  if (!props.timed) return true
  const previousRemaining = remainingByIndex.value[currentQuestion.value - 1] ?? props.duration
  return previousRemaining > 0
})

const submitDialog = ref<HTMLDialogElement | null>(null)
const quitDialog = ref<HTMLDialogElement | null>(null)

function askSubmit() {
  submitDialog.value?.showModal()
}

function confirmSubmit() {
  submitDialog.value?.close()
  submitAnswer()
}

function askQuit() {
  quitDialog.value?.showModal()
}

function confirmQuit() {
  quitDialog.value?.close()
  emit('quit-quiz')
}

watch(currentQuestion, () => {
  if (props.timed) startTimer()
})
if (props.timed) startTimer()
onUnmounted(clearTimer)
</script>

<template>
  <div class="card w-full max-w-2xl bg-base-200 shadow-xl mx-auto mt-6">
    <div class="card-body">
      <div class="flex items-center justify-between">
        <h2 class="card-title">Question {{ currentQuestion + 1 }}</h2>
        <span v-if="timed" class="badge badge-primary badge-lg font-mono">{{ remaining }}s</span>
        <span v-else class="badge badge-soft badge-lg font-mono">
          {{ currentQuestion + 1 }}/{{ props.questions.length }}
        </span>
      </div>

      <progress
        class="progress progress-primary w-full"
        :value="(currentQuestion + 1) / props.questions.length"
        :max="1"
      ></progress>

      <template v-if="timed">
        <p class="text-sm opacity-70">Time left: {{ remaining }}s</p>
        <progress
          class="progress progress-warning w-full"
          :max="duration"
          :value="remaining"
        ></progress>
      </template>

      <h3 class="text-lg font-semibold mt-2">{{ questions[currentQuestion].question }}</h3>

      <div class="grid gap-2">
        <button
          v-for="option in shuffleOptions"
          :key="option"
          type="button"
          class="btn btn-outline w-full justify-start"
          :class="{ 'btn-primary': option === selectedOption }"
          @click="selectedOption = option"
        >
          {{ option }}
        </button>
      </div>

      <div class="card-actions justify-between mt-4">
        <div class="flex gap-2">
          <button class="btn btn-ghost text-error" @click="askQuit">Quit</button>
          <button class="btn" @click="goBack" :disabled="!canGoBack">Back</button>
        </div>
        <button
          v-if="currentQuestion === props.questions.length - 1"
          class="btn btn-primary"
          @click="askSubmit"
          :disabled="!timed && selectedOption === null"
        >
          Submit
        </button>
        <button
          v-else
          class="btn btn-primary"
          @click="submitAnswer"
          :disabled="!timed && selectedOption === null"
        >
          Next
        </button>
      </div>
    </div>

    <dialog ref="submitDialog" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Submit quiz?</h3>
        <p class="py-4">Are you sure to submit this quiz?</p>
        <div class="modal-action">
          <button class="btn" @click="submitDialog?.close()">Cancel</button>
          <button class="btn btn-primary" @click="confirmSubmit">Yes</button>
        </div>
      </div>
    </dialog>

    <dialog ref="quitDialog" class="modal">
      <div class="modal-box">
        <h3 class="text-lg font-bold">Quit quiz?</h3>
        <p class="py-4">Your progress will be lost. Are you sure you want to quit?</p>
        <div class="modal-action">
          <button class="btn" @click="quitDialog?.close()">Cancel</button>
          <button class="btn btn-error" @click="confirmQuit">Yes, quit</button>
        </div>
      </div>
    </dialog>
  </div>
</template>
