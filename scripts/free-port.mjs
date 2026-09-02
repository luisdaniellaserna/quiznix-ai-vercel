// Kills whatever is listening on a TCP port (used before dev:all so stale
// room-server processes don't hold port 8787 after a crashed session).
import { execSync } from 'node:child_process'

const port = process.argv[2]
if (!port) {
  console.error('usage: node scripts/free-port.mjs <port>')
  process.exit(1)
}

const isWindows = process.platform === 'win32'

function findPids() {
  if (isWindows) {
    const out = execSync(`netstat -ano | findstr "LISTENING" | findstr ":${port} "`, {
      encoding: 'utf8',
    })
    return [
      ...new Set(
        out
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => /^\d+$/.test(pid)),
      ),
    ]
  }
  return execSync(`lsof -ti :${port}`, { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((pid) => /^\d+$/.test(pid))
}

try {
  const pids = findPids()
  if (pids.length === 0) {
    console.log(`[free-port] port ${port} is free`)
    process.exit(0)
  }
  for (const pid of pids) {
    try {
      execSync(isWindows ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`)
      console.log(`[free-port] killed process ${pid} holding port ${port}`)
    } catch {
      console.log(`[free-port] could not kill process ${pid}`)
    }
  }
} catch {
  console.log(`[free-port] port ${port} is free`)
}
