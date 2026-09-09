<script lang="ts" setup>
import TriviaCard from './TriviaCard.vue'
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-4 mt-20 px-4">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <p class="text-lg opacity-80">Loading your quiz...</p>
    <TriviaCard :interval-ms="8000" :refresh-on-mount="false" variant="poster" />
  </div>
</template>
