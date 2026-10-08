<script lang="ts" setup>
import { RouterLink } from 'vue-router'
import { Icon } from '@iconify/vue'
import pkg from '../../package.json'
import { GAMES, isPlayable } from '../games/registry'

const appVersion = `v${pkg.version}`
const hasAiKey = Boolean(import.meta.env.VITE_DEEPSEEK_API_KEY)
const blocked = GAMES.filter((game) => !isPlayable(game, hasAiKey))

function playable(game: (typeof GAMES)[number]) {
  return isPlayable(game, hasAiKey)
}

const steps = [
  { title: 'Pick a game', text: 'Each one trains a different corner of your head.' },
  { title: 'Play at your pace', text: 'Most games are solo first, with a state you can chase.' },
  { title: 'Beat yourself', text: 'Records are kept per game, right here in your browser.' },
]
</script>

<template>
  <div
    class="relative -mx-4 -mt-6 overflow-hidden px-4 pb-4 pt-10"
    style="
      background: linear-gradient(
        160deg,
        color-mix(in oklab, var(--color-primary) 18%, var(--color-base-100)) 0%,
        color-mix(in oklab, var(--color-secondary) 22%, var(--color-base-100)) 55%,
        color-mix(in oklab, var(--color-accent) 18%, var(--color-base-100)) 100%
      );
    "
  >
    <section class="relative z-10 mx-auto max-w-3xl py-6 text-center sm:py-10">
      <h1 class="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
        Get addicted<br />to learning
      </h1>
      <p class="mx-auto mt-5 max-w-xl text-lg font-medium opacity-80">
        A growing set of games that sharpen your mind — pick one and play.
      </p>
    </section>
  </div>

  <section class="mt-8 grid gap-5 sm:grid-cols-2">
    <component
      :is="playable(game) ? RouterLink : 'div'"
      v-for="game in GAMES"
      :key="game.id"
      :to="playable(game) ? game.path : undefined"
      class="group rounded-2xl border-2 border-base-300 bg-base-100 p-6 text-left transition"
      :class="
        playable(game) ? 'hover:border-primary hover:shadow-lg' : 'cursor-not-allowed opacity-60'
      "
    >
      <div class="flex items-start justify-between gap-3">
        <span class="text-4xl">{{ game.icon }}</span>
        <span v-if="!playable(game)" class="badge badge-soft badge-warning badge-sm gap-1">
          <Icon icon="lucide:key-round" class="h-3 w-3" />
          needs an AI key
        </span>
      </div>
      <h2 class="mt-3 text-lg font-bold">{{ game.name }}</h2>
      <p class="mt-1 text-sm opacity-70">{{ game.tagline }}</p>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <span v-for="mode in game.modes" :key="mode" class="badge badge-soft badge-sm capitalize">
          {{ mode }}
        </span>
        <span
          v-if="playable(game)"
          class="ml-auto text-sm font-semibold text-primary opacity-0 transition group-hover:opacity-100"
        >
          Play →
        </span>
      </div>
    </component>
  </section>

  <div v-if="blocked.length > 0" role="alert" class="alert alert-warning mt-6 text-sm">
    <Icon icon="lucide:triangle-alert" class="h-4 w-4 shrink-0" />
    <span>
      {{ blocked.map((game) => game.name).join(', ') }} needs <code>VITE_DEEPSEEK_API_KEY</code> in
      <code>.env</code> before it can be played.
    </span>
  </div>

  <section class="mt-12">
    <h2 class="text-2xl font-black tracking-tight">How it works</h2>
    <div class="mt-5 grid gap-4 sm:grid-cols-3">
      <div v-for="(step, index) in steps" :key="step.title" class="rounded-2xl bg-base-200/60 p-5">
        <div
          class="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-content"
        >
          {{ index + 1 }}
        </div>
        <h3 class="mt-3 font-bold">{{ step.title }}</h3>
        <p class="mt-1 text-sm opacity-70">{{ step.text }}</p>
      </div>
    </div>
  </section>

  <p class="mt-10 text-xs opacity-50">{{ appVersion }}</p>
</template>
