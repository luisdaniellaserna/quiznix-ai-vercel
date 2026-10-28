<script lang="ts" setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{
    icon: string
    value: string | number
    label: string
    tone?: 'primary' | 'secondary' | 'accent' | 'success'
  }>(),
  { tone: 'primary' },
)

const TONES: Record<string, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  accent: 'text-accent',
  success: 'text-success',
}

const toneClass = computed(() => TONES[props.tone])
</script>

<template>
  <div class="panel flex min-w-0 items-center gap-2.5 px-4 py-3.5 sm:gap-3 sm:px-5">
    <Icon :icon="icon" class="h-5 w-5 shrink-0" :class="toneClass" aria-hidden="true" />
    <div class="min-w-0">
      <!-- Silkscreen's glyphs sit small inside the em box, so display numerals
           need a size or two more than the sans equivalent to read as "big". -->
      <p class="pixel-number text-2xl leading-none sm:text-[1.75rem]">{{ value }}</p>
      <p class="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] opacity-55 sm:text-[10px]">
        {{ label }}
      </p>
    </div>
  </div>
</template>
