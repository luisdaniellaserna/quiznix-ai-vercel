<script setup lang="ts">
import AppHeader from './shell/AppHeader.vue'
import ArcadeBackdrop from './shell/ArcadeBackdrop.vue'
import RoomGuard from './shell/RoomGuard.vue'
</script>

<template>
  <div class="relative flex min-h-screen flex-col overflow-x-hidden text-base-content">
    <!-- one canvas for every route: the views no longer paint their own -->
    <ArcadeBackdrop />

    <AppHeader />

    <!-- no shared max-width here: each view owns its container so the dashboard
         can paint a full-bleed background behind the whole page -->
    <main class="relative z-10 flex flex-1 flex-col">
      <RouterView />
    </main>

    <!-- room eviction can land on any route, so it lives in the shell -->
    <RoomGuard />
  </div>
</template>
