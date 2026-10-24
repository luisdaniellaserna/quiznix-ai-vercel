<script lang="ts" setup>
import TriviaCard from './TriviaCard.vue'
</script>

<template>
  <div class="app-container flex flex-col items-center justify-center gap-6 py-20">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="pixel-title text-xl">Loading your quiz…</p>
    <TriviaCard :interval-ms="8000" :refresh-on-mount="false" variant="poster" />
  </div>
</template>
