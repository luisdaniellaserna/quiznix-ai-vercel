<script lang="ts" setup>
import { RouterLink } from 'vue-router'
import { Icon } from '@iconify/vue'
import pkg from '../../package.json'
import { GAMES, isPlayable, type GameDefinition, type GameMode } from '../games/registry'

const appVersion = `v${pkg.version}`
const hasAiKey = Boolean(import.meta.env.VITE_DEEPSEEK_API_KEY)
const blocked = GAMES.filter((game) => !isPlayable(game, hasAiKey))

function playable(game: GameDefinition) {
  return isPlayable(game, hasAiKey)
}

// one icon and one tone per mode, so the tags read apart at a glance
const MODE_ICON: Record<GameMode, string> = { solo: 'lucide:user', group: 'lucide:users' }
const MODE_TONE: Record<GameMode, string> = { solo: 'badge-primary', group: 'badge-secondary' }

const steps = [
  { title: 'Pick a game', text: 'Each one trains a different corner of your head.' },
  { title: 'Play at your pace', text: 'Most games are solo first, with a state you can chase.' },
  { title: 'Beat yourself', text: 'Records are kept per game, right here in your browser.' },
]

/** The hero CTA jumps to the grid rather than being a dead end. */
function startPlaying() {
  const target = document.getElementById('games')
  if (!target) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    target.scrollIntoView({ block: 'start' })
    return
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // Some engines drop a programmatic smooth scroll entirely, which would leave
  // the button looking dead. If nothing moved, jump instead.
  window.setTimeout(() => {
    if (window.scrollY < 8 && target.getBoundingClientRect().top > 120) {
      target.scrollIntoView({ block: 'start' })
    }
  }, 600)
}
</script>

<template>
  <!-- The original Mind Gym background: a soft theme-tinted wash with a mesh
       glow that fades out, so the cards sit on colour instead of a flat page. -->
  <div
    class="relative flex-1 overflow-x-hidden text-base-content"
    style="
      background: linear-gradient(
        160deg,
        color-mix(in oklab, var(--color-primary) 25%, var(--color-base-100)) 0%,
        color-mix(in oklab, var(--color-secondary) 35%, var(--color-base-100)) 55%,
        color-mix(in oklab, var(--color-accent) 30%, var(--color-base-100)) 100%
      );
    "
  >
    <div
      class="pointer-events-none absolute inset-x-0 top-0 h-3/4 [background-image:radial-gradient(55%_75%_at_18%_8%,color-mix(in_oklab,var(--color-primary)_24%,transparent)_0%,transparent_72%),radial-gradient(45%_65%_at_82%_18%,color-mix(in_oklab,var(--color-secondary)_22%,transparent)_0%,transparent_72%),radial-gradient(38%_55%_at_55%_42%,color-mix(in_oklab,var(--color-accent)_16%,transparent)_0%,transparent_68%)] [mask-image:linear-gradient(to_bottom,#000_35%,transparent)]"
    ></div>

    <section id="hero" class="relative isolate">
      <div class="app-container pb-4 pt-14 text-center sm:pt-20">
        <h1 class="text-4xl font-black leading-tight tracking-[-0.01em] sm:text-5xl lg:text-6xl">
          Get addicted to learning
        </h1>
        <p
          class="text-base-content/80 mx-auto mt-5 max-w-2xl text-lg font-medium leading-relaxed sm:text-xl"
        >
          A growing set of games that sharpen your mind — pick one and play.
        </p>
        <button
          type="button"
          class="btn btn-primary btn-lg mt-8 rounded-full border-0 px-8 text-base font-semibold shadow-lg transition duration-200 hover:brightness-110 focus-visible:ring-primary focus-visible:ring-offset-base-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none"
          @click="startPlaying"
        >
          <Icon icon="lucide:play" class="h-5 w-5" />
          Start playing
        </button>
      </div>
    </section>

    <div class="app-container relative pb-8 pt-12 sm:pt-16">
      <section id="games" class="scroll-mt-24">
        <h2 class="text-2xl font-black tracking-tight sm:text-3xl">Games</h2>

        <div
          class="mt-6 grid gap-6"
          :class="GAMES.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'"
        >
          <component
            :is="playable(game) ? RouterLink : 'div'"
            v-for="game in GAMES"
            :key="game.id"
            :to="playable(game) ? game.path : undefined"
            class="group flex min-h-[13rem] flex-col rounded-2xl border-2 border-base-300 bg-base-100 p-6 transition duration-200 focus-visible:ring-primary focus-visible:ring-offset-base-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            :class="
              playable(game)
                ? 'hover:border-primary hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0'
                : 'cursor-not-allowed opacity-60'
            "
          >
            <div class="flex items-start justify-between gap-3">
              <span
                class="flex h-12 w-12 items-center justify-center rounded-xl transition duration-200 motion-reduce:transition-none"
                :class="
                  playable(game)
                    ? 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-content'
                    : 'bg-base-200 text-base-content/60'
                "
              >
                <Icon :icon="game.icon" class="h-6 w-6" />
              </span>
              <span
                v-if="!playable(game)"
                class="badge badge-warning badge-sm badge-soft gap-1 whitespace-nowrap"
              >
                <Icon icon="lucide:key-round" class="h-3 w-3" />
                Needs an AI key
              </span>
            </div>

            <div class="mt-4 flex-1">
              <h3 class="text-xl font-bold tracking-tight">{{ game.name }}</h3>
              <p class="text-base-content/80 mt-2 text-[15px] leading-relaxed sm:text-base">
                {{ game.tagline }}
              </p>
            </div>

            <div class="mt-5 flex items-center justify-between gap-2">
              <div class="flex flex-wrap gap-2">
                <span
                  v-for="mode in game.modes"
                  :key="mode"
                  class="badge badge-sm gap-1.5 px-3 py-3 text-xs font-medium capitalize"
                  :class="`badge-soft ${MODE_TONE[mode]}`"
                >
                  <Icon :icon="MODE_ICON[mode]" class="h-3.5 w-3.5" />
                  {{ mode }}
                </span>
              </div>

              <span
                v-if="playable(game)"
                class="text-primary flex shrink-0 items-center gap-1 text-sm font-semibold"
              >
                Play
                <Icon
                  icon="lucide:arrow-right"
                  class="h-4 w-4 transition duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                />
              </span>
            </div>
          </component>
        </div>

        <p
          v-if="blocked.length > 0"
          role="alert"
          class="border-warning/40 bg-warning/10 mt-6 flex items-start gap-3 rounded-xl border p-4 text-sm"
        >
          <Icon icon="lucide:key-round" class="text-warning mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {{ blocked.map((game) => game.name).join(', ') }} needs
            <code>VITE_DEEPSEEK_API_KEY</code> in <code>.env</code> before it can be played.
          </span>
        </p>
      </section>

      <section id="how-it-works" class="mt-12 sm:mt-16">
        <h2 class="text-2xl font-black tracking-tight sm:text-3xl">How it works</h2>

        <div class="mt-6 rounded-2xl border border-base-300 bg-base-200/60 p-6 sm:p-8">
          <ol class="grid gap-6 sm:grid-cols-3">
            <li
              v-for="(step, index) in steps"
              :key="step.title"
              class="relative flex flex-col items-start gap-3"
            >
              <!-- connector to the next step, drawn from this badge into the gap -->
              <span
                v-if="index < steps.length - 1"
                class="absolute left-14 right-[-24px] top-6 hidden h-0.5 rounded-full bg-primary/30 sm:block"
                aria-hidden="true"
              ></span>
              <span
                class="relative z-10 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-content shadow-sm"
              >
                {{ index + 1 }}
              </span>
              <h3 class="font-bold">{{ step.title }}</h3>
              <p class="text-base-content/80 text-[15px] leading-relaxed sm:text-base">
                {{ step.text }}
              </p>
            </li>
          </ol>
        </div>
      </section>

      <footer
        class="text-base-content/80 mt-12 flex flex-wrap items-center justify-between gap-2 border-t border-base-300 pb-10 pt-6 text-sm"
      >
        <span>Mind Gym</span>
        <span class="tabular-nums">{{ appVersion }}</span>
      </footer>
    </div>
  </div>
</template>
