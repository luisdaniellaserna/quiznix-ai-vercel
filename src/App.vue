<script setup lang="ts">
import AppHeader from './shell/AppHeader.vue'
import RoomGuard from './shell/RoomGuard.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col overflow-x-hidden bg-base-100 text-base-content">
    <AppHeader />

    <!-- no shared max-width here: each view owns its container so the dashboard
         can paint a full-bleed background behind the whole page -->
    <main class="flex flex-1 flex-col">
      <RouterView />
    </main>

    <!-- room eviction can land on any route, so it lives in the shell -->
    <RoomGuard />
  </div>
</template>
