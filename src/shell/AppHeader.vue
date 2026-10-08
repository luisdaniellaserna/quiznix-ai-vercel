<script lang="ts" setup>
import { RouterLink } from 'vue-router'
import { Icon } from '@iconify/vue'
import SettingsMenu from './SettingsMenu.vue'
import { shellChrome } from './chrome'

function quit() {
  shellChrome.quit?.()
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-base-300 bg-base-100/90 backdrop-blur">
    <div class="app-container flex items-center justify-between gap-3 py-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <RouterLink
          to="/"
          class="group flex min-w-0 items-center gap-2.5 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100"
        >
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-content transition duration-200 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          >
            <Icon icon="lucide:brain" class="h-5 w-5" />
          </span>
          <span class="truncate text-lg font-black tracking-tight">Mind Gym</span>
        </RouterLink>

        <span
          v-if="shellChrome.context"
          class="badge badge-secondary badge-sm hidden sm:inline-flex"
        >
          {{ shellChrome.context }}
        </span>
      </div>

      <SettingsMenu
        :show-quit="Boolean(shellChrome.quit)"
        :quit-label="shellChrome.quitLabel || 'Quit game'"
        @quit-quiz="quit"
      />
    </div>
  </header>
</template>
