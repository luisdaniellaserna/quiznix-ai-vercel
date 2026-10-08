<script setup lang="ts">
import AppHeader from './shell/AppHeader.vue'
import RoomGuard from './shell/RoomGuard.vue'
</script>

<template>
  <div class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">
    <AppHeader />

    <main class="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">
      <RouterView />
    </main>

    <!-- room eviction can land on any route, so it lives in the shell -->
    <RoomGuard />
  </div>
</template>
