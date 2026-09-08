<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    particleCount?: number
    durationMs?: number
  }>(),
  {
    particleCount: 140,
    durationMs: 2800,
  },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
let rafId = 0
let timeoutId: ReturnType<typeof setTimeout> | undefined

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  color: string
  rotation: number
  rotationSpeed: number
}

const COLORS = ['#fbbf24', '#f472b6', '#34d399', '#60a5fa', '#a78bfa', '#f87171', '#facc15']

function burst() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const context: CanvasRenderingContext2D = ctx

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.scale(dpr, dpr)

  const particles: Particle[] = Array.from({ length: props.particleCount }, () => ({
    x: width / 2 + (Math.random() - 0.5) * width * 0.3,
    y: height * 0.25,
    vx: (Math.random() - 0.5) * 11,
    vy: -(Math.random() * 9 + 4),
    w: Math.random() * 8 + 5,
    h: Math.random() * 6 + 4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.3,
  }))

  const gravity = 0.28
  const drag = 0.99
  const start = performance.now()

  function frame(now: number) {
    const elapsed = now - start
    context.clearRect(0, 0, width, height)
    for (const p of particles) {
      p.vy += gravity
      p.vx *= drag
      p.vy *= drag
      p.x += p.vx
      p.y += p.vy
      p.rotation += p.rotationSpeed
      context.save()
      context.translate(p.x, p.y)
      context.rotate(p.rotation)
      context.fillStyle = p.color
      context.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      context.restore()
    }
    if (elapsed < props.durationMs) {
      rafId = requestAnimationFrame(frame)
    } else {
      context.clearRect(0, 0, width, height)
    }
  }
  rafId = requestAnimationFrame(frame)
}

onMounted(() => {
  // static or reduced-motion users get the leaderboard without the explosion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // let the leaderboard paint first so the burst lands on top of it
  timeoutId = setTimeout(burst, 120)
})

onUnmounted(() => {
  cancelAnimationFrame(rafId)
  if (timeoutId !== undefined) clearTimeout(timeoutId)
})
</script>

<template>
  <canvas ref="canvasRef" class="pointer-events-none fixed inset-0 z-50" aria-hidden="true" />
</template>
