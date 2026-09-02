import { fileURLToPath, URL } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

const ROOM_SERVER_PORT = Number(process.env.PORT) || 8787

function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}

// starts the group-mode room server alongside the dev server so `npm run dev`
// works on its own; skipped when a room server is already running
function roomServerDevPlugin(): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'quiztify-room-server',
    configureServer(server) {
      server.httpServer?.once('listening', async () => {
        if (await isPortBusy(ROOM_SERVER_PORT)) {
          return
        }
        const serverPath = fileURLToPath(new URL('./server/index.mjs', import.meta.url))
        child = spawn(process.execPath, [serverPath], { stdio: 'inherit' })
      })
      server.httpServer?.once('close', () => {
        child?.kill()
        child = null
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss(), roomServerDevPlugin()],
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
