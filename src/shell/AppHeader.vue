<script lang="ts" setup>
import { RouterLink } from 'vue-router'
import SettingsMenu from './SettingsMenu.vue'
import { shellChrome } from './chrome'

function quit() {
  shellChrome.quit?.()
}
</script>

<template>
  <header class="navbar bg-base-200 px-4 py-4 shadow-sm">
    <div class="navbar-start gap-2">
      <RouterLink to="/" class="text-xl font-black tracking-tight transition hover:opacity-80">
        Mind Gym
      </RouterLink>
      <span v-if="shellChrome.context" class="badge badge-secondary badge-sm hidden sm:inline-flex">
        {{ shellChrome.context }}
      </span>
    </div>
    <div class="navbar-end">
      <SettingsMenu
        :show-quit="Boolean(shellChrome.quit)"
        :quit-label="shellChrome.quitLabel || 'Quit game'"
        @quit-quiz="quit"
      />
    </div>
  </header>
</template>
