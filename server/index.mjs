import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { RoomManager } from './roomManager.mjs'

const PORT = Number(process.env.PORT) || 8787
const SWEEP_INTERVAL_MS = 30 * 60 * 1000

function lanAddresses() {
  const addresses = []
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push(info.address)
      }
    }
  }
  return addresses
}

const manager = new RoomManager({ onSend: route })

// clientId -> { code, role: 'host' | 'player', playerId? }
const clientInfo = new Map()
// clientId -> WebSocket, WebSocket -> clientId
const clientSockets = new Map()
const socketClients = new Map()
// code -> { hostClientId, players: Map<playerId, clientId> }
const roomClients = new Map()

function send(clientId, message) {
  const ws = clientSockets.get(clientId)
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message))
  }
}

function sendError(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'error', message }))
  }
}

function route({ to, message, code, clientId }) {
  const room = roomClients.get(code)
  if (!room) {
    // `room-created` fires before the room is registered in the layer
    if (to === 'host' && clientId) {
      send(clientId, message)
    }
    return
  }
  if (to === 'host' || to === 'all') {
    send(room.hostClientId, message)
  }
  if (to === 'players' || to === 'all') {
    for (const id of room.players.values()) {
      send(id, message)
    }
  } else if (to !== 'host') {
    const target = room.players.get(to)
    if (target) {
      send(target, message)
    } else {
      // `joined` is emitted before the joiner's socket is registered
      send(clientId, message)
    }
  }
}

function cleanupRoom(code) {
  const room = roomClients.get(code)
  if (!room) {
    return
  }
  roomClients.delete(code)
  for (const clientId of [room.hostClientId, ...room.players.values()]) {
    clientInfo.delete(clientId)
    clientSockets.get(clientId)?.close(1000, 'room closed')
  }
}

function handleMessage(ws, raw) {
  const clientId = socketClients.get(ws)
  let message
  try {
    message = JSON.parse(raw.toString())
  } catch {
    sendError(ws, 'Invalid message.')
    return
  }

  try {
    switch (message.type) {
      case 'create-room': {
        const { code } = manager.createRoom(clientId, {
          topic: message.topic,
          timerSeconds: message.timerSeconds,
          maxPlayers: message.maxPlayers,
          questions: message.questions,
        })
        roomClients.set(code, { hostClientId: clientId, players: new Map() })
        clientInfo.set(clientId, { code, role: 'host' })
        console.log(`[room ${code}] created by host`)
        break
      }
      case 'join': {
        const { code, playerId } = manager.joinRoom(clientId, message.code, message.name)
        // ensure roomClients entry exists (host grace may have kept it)
        if (!roomClients.has(code)) {
          roomClients.set(code, { hostClientId: manager.rooms.get(code)?.hostClientId ?? null, players: new Map() })
        }
        roomClients.get(code).players.set(playerId, clientId)
        clientInfo.set(clientId, { code, role: 'player', playerId })
        console.log(`[room ${code}] player ${playerId} joined as "${message.name}"`)
        break
      }
      case 'rejoin': {
        const { code, playerId } = manager.rejoin(clientId, message.code, message.playerId, message.name)
        if (!roomClients.has(code)) {
          roomClients.set(code, { hostClientId: manager.rooms.get(code)?.hostClientId ?? null, players: new Map() })
        }
        roomClients.get(code).players.set(playerId, clientId)
        clientInfo.set(clientId, { code, role: 'player', playerId })
        console.log(`[room ${code}] player ${playerId} rejoined as "${message.name}"`)
        break
      }
      case 'rejoinHost': {
        const { code } = manager.rejoinHost(clientId, message.code)
        const entry = roomClients.get(code)
        if (entry) {
          entry.hostClientId = clientId
        } else {
          roomClients.set(code, { hostClientId: clientId, players: new Map() })
        }
        clientInfo.set(clientId, { code, role: 'host' })
        console.log(`[room ${code}] host rejoined`)
        break
      }
      case 'start-game':
        manager.startGame(clientId)
        break
      case 'answer':
        manager.submitAnswer(clientId, message.option)
        break
      case 'next-question':
        manager.nextQuestion(clientId)
        break
      case 'close-room': {
        manager.closeRoom(clientId)
        const info = clientInfo.get(clientId)
        if (info?.role === 'host') {
          cleanupRoom(info.code)
        }
        break
      }
      default:
        sendError(ws, 'Unknown message type.')
    }
  } catch (err) {
    sendError(ws, err instanceof Error ? err.message : 'Something went wrong.')
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/lan') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({ addresses: lanAddresses() }))
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const wss = new WebSocketServer({ server })

function heartbeat() {
  this.isAlive = true
}

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', heartbeat)

  const clientId = `c-${randomUUID()}`
  clientSockets.set(clientId, ws)
  socketClients.set(ws, clientId)

  ws.on('message', (raw) => handleMessage(ws, raw))
  ws.on('error', (err) => console.error(`[client ${clientId}] socket error:`, err.message))
  ws.on('close', () => {
    socketClients.delete(ws)
    clientSockets.delete(clientId)
    const info = clientInfo.get(clientId)
    if (!info) {
      return
    }
    if (info.role === 'host') {
      manager.hostDisconnected(clientId)
      const entry = roomClients.get(info.code)
      if (entry) entry.hostClientId = null
      clientInfo.delete(clientId)
      console.log(`[room ${info.code}] host disconnected — grace 60s`)
    } else {
      manager.playerDisconnected(clientId)
      const entry = roomClients.get(info.code)
      if (entry) {
        for (const [pid, cid] of entry.players) {
          if (cid === clientId) {
            entry.players.set(pid, null)
            break
          }
        }
        // keep entry for 90s grace; rejoin will restore
      }
      clientInfo.delete(clientId)
      console.log(`[room ${info.code}] player ${info.playerId} disconnected — grace 90s`)
    }
  })
})

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on('close', () => clearInterval(heartbeatInterval))

setInterval(() => {
  for (const code of manager.sweep()) {
    console.log(`[room ${code}] swept after being idle`)
    cleanupRoom(code)
  }
}, SWEEP_INTERVAL_MS)

// more frequent grace sweep for 60s host / 90s player rejoin windows
setInterval(() => {
  const before = new Set(manager.rooms.keys())
  manager.sweep()
  // clean server's roomClients for rooms that were purged (host grace expiry)
  for (const code of Array.from(roomClients.keys())) {
    if (!manager.rooms.has(code)) {
      roomClients.delete(code)
    } else {
      const room = manager.rooms.get(code)
      const entry = roomClients.get(code)
      if (entry) {
        for (const [pid, cid] of Array.from(entry.players)) {
          if (cid === null && !room.players.has(pid)) {
            entry.players.delete(pid)
          }
        }
      }
    }
  }
  // also purge any pending host grace that was not caught (safety)
  for (const code of before) {
    if (!manager.rooms.has(code) && roomClients.has(code)) {
      roomClients.delete(code)
    }
  }
}, 10_000)

// fast tick for the 3s force-advance reveal (sweep alone is too coarse at 10s+)
setInterval(() => manager.processAdvances(), 250)

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[group server] port ${PORT} is already in use.`)
    console.error(`  find the process holding it:  netstat -ano | findstr :${PORT}  (Windows)`)
    console.error(`                                 lsof -i :${PORT}                 (macOS/Linux)`)
    console.error(`  then stop it, or run on another port:  PORT=${PORT + 1} npm run server`)
    process.exit(1)
  }
  throw err
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[group server] listening on ws://0.0.0.0:${PORT}`)
  for (const address of lanAddresses()) {
    console.log(`[group server] reachable on your network at ws://${address}:${PORT}`)
  }
  if (process.platform === 'win32') {
    console.log(
      '[group server] if other devices cannot connect, allow node.exe through Windows Firewall (Private networks)',
    )
  }
})
