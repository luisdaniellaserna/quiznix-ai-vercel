<script lang="ts" setup>
import { RouterLink } from 'vue-router'
import { Icon } from '@iconify/vue'
import pkg from '../../package.json'
import { GAMES, isPlayable, type GameDefinition, type GameMode } from '../games/registry'
import { loadBests as loadHanoiBests } from '../games/hanoi/bests'
import { loadBests as loadSudokuBests } from '../games/sudoku/bests'
import StatCard from '../shell/StatCard.vue'
import RidgeDivider from '../shell/RidgeDivider.vue'

const appVersion = `v${pkg.version}`
const hasAiKey = Boolean(import.meta.env.VITE_DEEPSEEK_API_KEY)
const blocked = GAMES.filter((game) => !isPlayable(game, hasAiKey))

function playable(game: GameDefinition) {
  return isPlayable(game, hasAiKey)
}

// one icon and one tone per mode, so the tags read apart at a glance
const MODE_ICON: Record<GameMode, string> = { solo: 'lucide:user', group: 'lucide:users' }
const MODE_TONE: Record<GameMode, string> = { solo: 'text-primary', group: 'text-secondary' }

/**
 * The reference's stat strip, filled with counts the app can actually back up:
 * the registry, the mode set, this browser's puzzle records, and the build.
 */
const stats = [
  { icon: 'lucide:gamepad-2', value: GAMES.length, label: 'Games', tone: 'primary' as const },
  {
    icon: 'lucide:users',
    value: new Set(GAMES.flatMap((game) => game.modes)).size,
    label: 'Game modes',
    tone: 'secondary' as const,
  },
  {
    icon: 'lucide:trophy',
    value: Object.keys(loadHanoiBests()).length + Object.keys(loadSudokuBests()).length,
    label: 'Records',
    tone: 'accent' as const,
  },
  {
    icon: 'lucide:package',
    value: pkg.version,
    label: 'Version',
    tone: 'success' as const,
  },
]

const steps = [
  { title: 'Pick a game', text: 'Each one trains a different corner of your head.' },
  { title: 'Play at your pace', text: 'Most games are solo first, with a state you can chase.' },
  { title: 'Beat yourself', text: 'Records are kept per game, right here in your browser.' },
]

/**
 * Every in-page jump goes through here. Some engines drop a programmatic smooth
 * scroll entirely, which would leave a button looking dead — if nothing moved,
 * jump instead.
 */
function scrollToId(id: string) {
  const target = document.getElementById(id)
  if (!target) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    target.scrollIntoView({ block: 'start' })
    return
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  window.setTimeout(() => {
    if (window.scrollY < 8 && target.getBoundingClientRect().top > 120) {
      target.scrollIntoView({ block: 'start' })
    }
  }, 600)
}
</script>

<template>
  <div class="relative flex-1 overflow-x-hidden text-base-content">
    <section id="hero" class="relative isolate">
      <div class="app-container-narrow pt-16 pb-6 text-center sm:pt-24">
        <span class="pixel-chip">
          <Icon icon="lucide:sparkles" class="text-accent h-3.5 w-3.5" aria-hidden="true" />
          Learning Arcade
        </span>

        <h1 class="pixel-title mt-8 text-[2rem] leading-[1.15] sm:text-5xl lg:text-6xl">
          <span class="block">Get Addicted</span>
          <span class="pixel-gradient mt-2 block">To Learning</span>
        </h1>

        <p
          class="pixel-caret text-base-content/65 mx-auto mt-8 max-w-xl text-[15px] leading-relaxed sm:text-lg"
        >
          A growing set of games that sharpen your mind — pick one and play.
        </p>

        <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            type="button"
            class="btn btn-primary btn-lg rounded-lg px-7 font-semibold focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 focus-visible:outline-none"
            @click="scrollToId('games')"
          >
            Start playing
            <Icon icon="lucide:arrow-right" class="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="btn btn-outline btn-lg border-base-300 rounded-lg px-7 font-semibold hover:border-primary hover:bg-base-200 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 focus-visible:outline-none"
            @click="scrollToId('how-it-works')"
          >
            <Icon icon="lucide:book-open" class="h-4 w-4" aria-hidden="true" />
            How it works
          </button>
        </div>

        <div class="mx-auto mt-12 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            v-for="stat in stats"
            :key="stat.label"
            :icon="stat.icon"
            :value="stat.value"
            :label="stat.label"
            :tone="stat.tone"
          />
        </div>
      </div>

      <RidgeDivider label="Scroll" />
    </section>

    <div class="app-container relative pt-10 pb-8 sm:pt-14">
      <section id="games" class="scroll-mt-24">
        <p class="eyebrow">Library</p>
        <h2 class="pixel-title mt-3 text-3xl sm:text-4xl">Games</h2>

        <div
          class="mt-7 grid gap-4 sm:gap-5"
          :class="GAMES.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'"
        >
          <component
            :is="playable(game) ? RouterLink : 'div'"
            v-for="game in GAMES"
            :key="game.id"
            :to="playable(game) ? game.path : undefined"
            class="panel panel-lift group flex min-h-[14rem] flex-col p-6 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100 focus-visible:outline-none"
            :class="playable(game) ? '' : 'cursor-not-allowed opacity-60'"
          >
            <div class="flex items-start justify-between gap-3">
              <span
                class="border-base-300 bg-base-100 flex h-12 w-12 items-center justify-center rounded-[0.45rem] border transition duration-200 group-hover:border-primary/50 group-hover:text-primary motion-reduce:transition-none"
                :class="playable(game) ? 'text-base-content/80' : 'text-base-content/50'"
              >
                <Icon :icon="game.icon" class="h-6 w-6" aria-hidden="true" />
              </span>
              <span
                v-if="!playable(game)"
                class="badge badge-warning badge-sm badge-soft gap-1 whitespace-nowrap"
              >
                <Icon icon="lucide:key-round" class="h-3 w-3" aria-hidden="true" />
                Needs an AI key
              </span>
            </div>

            <h3 class="pixel-title mt-5 text-lg">{{ game.name }}</h3>
            <p class="text-base-content/60 mt-3 flex-1 text-sm leading-relaxed">
              {{ game.tagline }}
            </p>

            <div class="border-base-300 mt-5 flex items-center justify-between gap-2 border-t pt-4">
              <div class="flex flex-wrap gap-3">
                <span
                  v-for="mode in game.modes"
                  :key="mode"
                  class="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase"
                  :class="MODE_TONE[mode]"
                >
                  <Icon :icon="MODE_ICON[mode]" class="h-3.5 w-3.5" aria-hidden="true" />
                  {{ mode }}
                </span>
              </div>

              <span
                v-if="playable(game)"
                class="text-primary flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.18em] uppercase"
              >
                Play
                <Icon
                  icon="lucide:arrow-right"
                  class="h-3.5 w-3.5 transition duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                  aria-hidden="true"
                />
              </span>
            </div>
          </component>
        </div>

        <p
          v-if="blocked.length > 0"
          role="alert"
          class="panel-quiet border-warning/40 bg-warning/10 mt-6 flex items-start gap-3 p-4 text-sm"
        >
          <Icon icon="lucide:key-round" class="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {{ blocked.map((game) => game.name).join(', ') }} needs
            <code>VITE_DEEPSEEK_API_KEY</code> in <code>.env</code> before it can be played.
          </span>
        </p>
      </section>

      <section id="how-it-works" class="mt-14 scroll-mt-24 sm:mt-20">
        <p class="eyebrow">Three steps</p>
        <h2 class="pixel-title mt-3 text-3xl sm:text-4xl">How it works</h2>

        <div class="panel-quiet mt-7 p-6 sm:p-8">
          <ol class="grid gap-8 sm:grid-cols-3 sm:gap-6">
            <li
              v-for="(step, index) in steps"
              :key="step.title"
              class="relative flex flex-col items-start gap-3"
            >
              <!-- connector to the next step, drawn from this badge into the gap -->
              <span
                v-if="index < steps.length - 1"
                class="bg-base-300 absolute top-5 left-14 right-[-24px] hidden h-px sm:block"
                aria-hidden="true"
              ></span>
              <span
                class="pixel-number border-primary/35 bg-primary/10 text-primary relative z-10 flex h-11 w-11 items-center justify-center rounded-[0.4rem] border text-lg"
              >
                {{ index + 1 }}
              </span>
              <h3 class="font-semibold">{{ step.title }}</h3>
              <p class="text-base-content/60 text-sm leading-relaxed">{{ step.text }}</p>
            </li>
          </ol>
        </div>
      </section>

      <footer
        class="border-base-300 mt-14 flex flex-wrap items-center justify-between gap-2 border-t pt-6 pb-12 font-mono text-[10px] tracking-[0.2em] uppercase opacity-50"
      >
        <span>MINDaura</span>
        <span>Records stay in your browser</span>
        <span class="tabular-nums">{{ appVersion }}</span>
      </footer>
    </div>
  </div>
</template>
