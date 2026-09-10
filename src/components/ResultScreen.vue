<script lang="ts" setup>
import { computed } from 'vue'

const props = defineProps<{
  userAnswers: UserAnswer[]
  score: number
  total: number
}>()

const emit = defineEmits(['reset'])

const percentage = computed(() =>
  props.total > 0 ? Math.round((props.score / props.total) * 100) : 0,
)
</script>

<template>
  <div class="mx-auto mt-6 w-full max-w-2xl space-y-4 p-4 sm:p-0">
    <div class="stats stats-vertical sm:stats-horizontal shadow w-full bg-base-200">
      <div class="stat">
        <div class="stat-title">Score</div>
        <div class="stat-value text-primary">{{ score }} / {{ total }}</div>
        <div class="stat-desc">{{ percentage }}% correct</div>
      </div>
    </div>

    <div
      v-for="(userAnswer, index) in userAnswers"
      :key="index"
      class="card bg-base-100 shadow border-l-4"
      :class="userAnswer.answer === userAnswer.question.correct_answer ? 'border-success' : 'border-error'"
    >
      <div class="card-body py-4">
        <h3 class="break-words font-semibold">{{ userAnswer.question.question }}</h3>
        <p>
          <span class="opacity-70">Your answer: </span>
          <span :class="userAnswer.answer === userAnswer.question.correct_answer ? 'text-success' : 'text-error'">
            {{ userAnswer.answer || 'No answer (timed out)' }}
          </span>
        </p>
        <p v-if="userAnswer.answer !== userAnswer.question.correct_answer" class="text-sm">
          <span class="opacity-70">Correct answer: </span>
          <span class="text-success">{{ userAnswer.question.correct_answer }}</span>
        </p>
        <p v-if="userAnswer.answer !== userAnswer.question.correct_answer && userAnswer.question.explanation" class="text-sm opacity-80">
          {{ userAnswer.question.explanation }}
        </p>
      </div>
    </div>

    <button class="btn btn-soft btn-primary w-full sm:w-auto btn-lg" @click="emit('reset')">Reset</button>
  </div>
</template>
