<script lang="ts" setup>
import { RouterLink, useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import SettingsMenu from './SettingsMenu.vue'
import BrandLogo from './BrandLogo.vue'
import { shellChrome } from './chrome'

function quit() {
  shellChrome.quit?.()
}

const route = useRoute()

/**
 * Landing anchors only. Individual games are not listed here on purpose: the
 * header stays the same no matter how many games the registry grows to. Hash
 * links resolve on `/`, which is why the router's scroll behaviour understands
 * `to.hash`.
 */
const links = [
  { label: 'Games', to: '/#games' },
  { label: 'How it works', to: '/#how-it-works' },
]

function isActive(to: string) {
  const [path, hash] = to.split('#')
  if (hash) return route.path === path && route.hash === `#${hash}`
  return route.path === path
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-base-300/70 bg-base-100/80 backdrop-blur-md">
    <div class="app-container relative flex h-16 items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <RouterLink
          to="/"
          class="group flex min-w-0 items-center rounded-lg py-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 focus-visible:outline-none"
        >
          <BrandLogo />
        </RouterLink>

        <span v-if="shellChrome.context" class="pixel-chip ml-1 hidden py-1 sm:inline-flex">
          {{ shellChrome.context }}
        </span>
      </div>

      <!-- centered on the page, independent of how wide the brand gets -->
      <nav
        class="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex"
        aria-label="Primary"
      >
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase transition duration-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none motion-reduce:transition-none"
          :class="
            isActive(link.to)
              ? 'text-primary'
              : 'text-base-content/65 hover:text-base-content hover:bg-base-200/70'
          "
        >
          {{ link.label }}
        </RouterLink>
      </nav>

      <div class="flex shrink-0 items-center gap-1.5">
        <RouterLink
          to="/#games"
          class="btn btn-primary btn-sm hidden rounded-lg px-4 font-semibold sm:inline-flex"
        >
          Start playing
        </RouterLink>

        <!-- below lg the links move into this menu -->
        <details class="dropdown dropdown-end lg:hidden">
          <summary
            class="btn btn-ghost btn-circle min-h-10 min-w-10 list-none [&::-webkit-details-marker]:hidden"
            aria-label="Browse pages"
          >
            <Icon icon="lucide:menu" class="h-5 w-5" aria-hidden="true" />
          </summary>
          <div
            class="dropdown-content border-base-300 bg-base-200 z-50 mt-1 w-56 rounded-lg border p-1.5 shadow-xl"
          >
            <RouterLink
              v-for="link in links"
              :key="`mobile-${link.to}`"
              :to="link.to"
              class="text-base-content/75 hover:bg-base-300/40 hover:text-base-content rounded-md px-3 py-2 font-mono text-[11px] tracking-[0.16em] uppercase"
              :class="isActive(link.to) ? 'text-primary' : ''"
            >
              {{ link.label }}
            </RouterLink>
          </div>
        </details>

        <SettingsMenu
          :show-quit="Boolean(shellChrome.quit)"
          :quit-label="shellChrome.quitLabel || 'Quit game'"
          @quit-quiz="quit"
        />
      </div>
    </div>
  </header>
</template>
