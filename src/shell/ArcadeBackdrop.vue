<script lang="ts" setup>
/**
 * The app-wide canvas: a starfield, long diagonal hairlines, a soft glow behind
 * the fold, and a few blurred word blocks for depth.
 *
 * It is painted once in the shell rather than per view, so every route sits on
 * the same surface. Purely decorative: no state, no listeners, and it is
 * aria-hidden so screen readers never see it.
 *
 * Every colour is a theme token, so on a light theme this reads as a faint
 * dotted paper texture instead of a broken dark layer.
 */
const WORDS = [
  { text: 'PLAY', class: 'left-[-2%] top-[16%] text-[9rem] sm:text-[13rem]' },
  { text: 'QUIZ', class: 'right-[-3%] top-[8%] text-[7rem] sm:text-[10rem]' },
  { text: 'THINK', class: 'right-[6%] top-[26%] text-[6rem] sm:text-[8rem]' },
]
</script>

<template>
  <div class="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
    <!-- soft light from above, the way the reference lifts its hero off the black -->
    <div
      class="absolute inset-x-0 top-0 h-[70vh] opacity-70 [background-image:radial-gradient(60%_60%_at_50%_-10%,color-mix(in_oklab,var(--color-primary)_16%,transparent)_0%,transparent_70%)]"
    ></div>

    <!-- three star densities, faded out before the content takes over -->
    <div
      class="starfield absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_0%,#000_58%,transparent_88%)]"
    ></div>

    <!-- long hairlines on the same 112° angle as the reference -->
    <div
      class="arcade-grid absolute inset-0 [mask-image:radial-gradient(78%_62%_at_50%_6%,#000_0%,transparent_76%)]"
    ></div>

    <!-- blurred word blocks: texture, never content -->
    <span
      v-for="word in WORDS"
      :key="word.text"
      class="backdrop-word absolute"
      :class="word.class"
      >{{ word.text }}</span
    >

    <!-- vignette, so the middle stays the brightest part of the page -->
    <div
      class="absolute inset-0 [background-image:radial-gradient(120%_90%_at_50%_40%,transparent_35%,var(--color-base-100)_100%)] opacity-80"
    ></div>
  </div>
</template>
