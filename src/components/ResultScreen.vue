<script lang="ts" setup>
import { computed } from 'vue'
import ConfettiBurst from '../shell/ConfettiBurst.vue'

const props = defineProps<{
  userAnswers: UserAnswer[]
  score: number
  total: number
}>()

const emit = defineEmits(['reset'])

const percentage = computed(() =>
  props.total > 0 ? Math.round((props.score / props.total) * 100) : 0,
)

const isPerfectScore = computed(() => props.total > 0 && props.score === props.total)
/**
 * Finishing is worth celebrating, but a confetti burst over "0 / 10" reads as
 * mockery, so the reward is gated on at least half right.
 */
const deservesConfetti = computed(() => props.total > 0 && percentage.value >= 50)
</script>

<template>
  <div class="app-container mt-6 w-full max-w-2xl space-y-4 py-10 sm:mx-auto">
    <ConfettiBurst
      v-if="deservesConfetti"
      :particle-count="isPerfectScore ? 180 : 90"
      :duration-ms="isPerfectScore ? 3200 : 2200"
    />

    <div class="stats stats-vertical border-base-300 w-full border sm:stats-horizontal">
      <div class="stat">
        <div class="stat-title font-mono text-[10px] tracking-[0.2em] uppercase">Score</div>
        <div class="stat-value pixel-number text-primary">{{ score }} / {{ total }}</div>
        <div class="stat-desc">{{ percentage }}% correct</div>
      </div>
    </div>

    <div
      v-for="(userAnswer, index) in userAnswers"
      :key="index"
      class="panel border-l-4"
      :class="
        userAnswer.answer === userAnswer.question.correct_answer
          ? 'border-l-success'
          : 'border-l-error'
      "
    >
      <div class="card-body py-4">
        <h3 class="font-semibold break-words">{{ userAnswer.question.question }}</h3>
        <p>
          <span class="opacity-70">Your answer: </span>
          <span
            :class="
              userAnswer.answer === userAnswer.question.correct_answer
                ? 'text-success'
                : 'text-error'
            "
          >
            {{ userAnswer.answer || 'No answer (timed out)' }}
          </span>
        </p>
        <p v-if="userAnswer.answer !== userAnswer.question.correct_answer" class="text-sm">
          <span class="opacity-70">Correct answer: </span>
          <span class="text-success">{{ userAnswer.question.correct_answer }}</span>
        </p>
        <p
          v-if="
            userAnswer.answer !== userAnswer.question.correct_answer &&
            userAnswer.question.explanation
          "
          class="text-sm opacity-80"
        >
          {{ userAnswer.question.explanation }}
        </p>
      </div>
    </div>

    <button class="btn btn-primary btn-lg w-full sm:w-auto" @click="emit('reset')">Reset</button>
  </div>
</template>
