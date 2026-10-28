<script lang="ts" setup>
/**
 * The layered ridge that closes a section the way the reference closes its hero.
 * Fills are mixed from theme tokens, so the silhouette deepens toward the canvas
 * instead of being a fixed navy that only works on black.
 */
withDefaults(defineProps<{ label?: string }>(), { label: '' })
</script>

<template>
  <div class="relative">
    <svg
      class="block h-24 w-full sm:h-32"
      viewBox="0 0 1440 180"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <!-- farthest ridge -->
      <path
        d="M0 120 C160 92 300 142 480 118 C660 94 780 134 960 110 C1140 86 1290 128 1440 104 L1440 180 L0 180 Z"
        fill="color-mix(in oklab, var(--color-secondary) 12%, var(--color-base-100))"
      />
      <!-- middle ridge, with the hairline of light along its crest -->
      <path
        d="M0 150 C120 120 240 84 380 106 C520 128 600 160 720 142 C840 124 900 72 1040 88 C1180 104 1320 140 1440 128 L1440 180 L0 180 Z"
        fill="color-mix(in oklab, var(--color-secondary) 8%, var(--color-base-100))"
        stroke="color-mix(in oklab, var(--color-primary) 28%, transparent)"
        stroke-width="1"
        vector-effect="non-scaling-stroke"
      />
      <!-- nearest ridge: a shade above the canvas, so its crest still reads -->
      <path
        d="M0 168 C180 150 300 164 460 158 C620 152 760 132 900 146 C1040 160 1220 170 1440 156 L1440 180 L0 180 Z"
        fill="color-mix(in oklab, var(--color-base-content) 5%, var(--color-base-100))"
      />
    </svg>

    <p
      v-if="label"
      class="pointer-events-none absolute inset-x-0 bottom-1 text-center font-mono text-[10px] uppercase tracking-[0.45em] opacity-45"
    >
      {{ label }}
    </p>
  </div>
</template>
