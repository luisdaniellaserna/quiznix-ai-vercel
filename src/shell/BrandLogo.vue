<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue'

/**
 * The brand lockup, cropped from the supplied PNG to its content box with the
 * flat plate colour keyed out, so the header shows through on every theme.
 *
 * The artwork is drawn for a light surface: dark "MIND" over a warm plate, with
 * the plate colour baked into the letters' counters. Keying the plate removes
 * those counters with it (which is correct) and leaves the anti-aliasing intact,
 * so for a dark canvas the whole image is inverted with the hue rotated back —
 * the lightness flips and every letterform survives unedited.
 *
 * The cut is chosen from the canvas colour rather than a theme list, so every
 * daisyUI theme — including ones added later — lands on the right treatment.
 */
function canvasIsDark(): boolean {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;background-color:var(--color-base-100)'
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()

  // daisyUI themes mostly define their palette in oklch, which cannot be parsed
  // with a digit match, so let the canvas resolve any colour syntax to sRGB.
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return true
  ctx.fillStyle = '#010203'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
}

const isDark = ref(canvasIsDark())
let observer: MutationObserver | undefined

onMounted(() => {
  observer = new MutationObserver(() => {
    isDark.value = canvasIsDark()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => observer?.disconnect())
</script>

<template>
  <img
    src="/mindaura-logo.png"
    alt="MINDaura"
    width="1200"
    height="281"
    class="brand-logo h-8 w-auto shrink-0 object-contain sm:h-9"
    :class="{ 'brand-logo--invert': isDark }"
  />
</template>

<style scoped>
.brand-logo--invert {
  filter: invert(1) hue-rotate(180deg);
}
</style>
