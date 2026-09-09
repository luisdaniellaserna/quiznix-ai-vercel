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

/** Close sockets displaced by a secret-bearing rejoin (ghost authority). */
function displaceSockets(clientIds, reason) {
  for (const cid of clientIds ?? []) {
    const ws = clientSockets.get(cid)
    clientInfo.delete(cid)
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.close(1000, reason)
      } catch {}
    }
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
    // hostClientId may still hold the previous (dead) socket during a rebind —
    // the fresh clientId passed with targeted emits always wins for delivery.
    send(room.hostClientId || clientId, message)
  }
  if (to === 'players' || to === 'all') {
    for (const id of room.players.values()) {
      send(id, message)
    }
  } else if (to !== 'host') {
    // targeted emits (joined, state-sync, kicked) always carry the recipient's
    // current socket as clientId; the players map can still point at a stale
    // socket mid-rebind, so prefer clientId and only fall back to the map.
    if (clientId) {
      send(clientId, message)
    } else {
      const target = room.players.get(to)
      if (target) {
        send(target, message)
      }
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
          roomClients.set(code, {
            hostClientId: manager.rooms.get(code)?.hostClientId ?? null,
            players: new Map(),
          })
        }
        roomClients.get(code).players.set(playerId, clientId)
        clientInfo.set(clientId, { code, role: 'player', playerId })
        console.log(`[room ${code}] player ${playerId} joined as "${message.name}"`)
        break
      }
      case 'rejoin': {
        const { code, playerId, displaced } = manager.rejoin(
          clientId,
          message.code,
          message.playerId,
          message.name,
          message.secret,
        )
        if (!roomClients.has(code)) {
          roomClients.set(code, {
            hostClientId: manager.rooms.get(code)?.hostClientId ?? null,
            players: new Map(),
          })
        }
        roomClients.get(code).players.set(playerId, clientId)
        clientInfo.set(clientId, { code, role: 'player', playerId })
        displaceSockets(displaced, 'superseded')
        console.log(`[room ${code}] player ${playerId} rejoined as "${message.name}"`)
        break
      }
      case 'rejoinHost': {
        const { code, displaced } = manager.rejoinHost(clientId, message.code, message.secret)
        const entry = roomClients.get(code)
        if (entry) {
          entry.hostClientId = clientId
        } else {
          roomClients.set(code, { hostClientId: clientId, players: new Map() })
        }
        clientInfo.set(clientId, { code, role: 'host' })
        displaceSockets(displaced, 'superseded')
        console.log(`[room ${code}] host rejoined`)
        break
      }
      case 'ping': {
        // application-level keepalive: any traffic defeats proxy idle timeouts
        // (Render free tier) that low-level ws pings don't always survive
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', serverNow: Date.now() }))
        }
        break
      }
      case 'client-exit': {
        // intentional leave from a live socket: free the seat immediately
        const result = manager.clientExit(clientId)
        if (result.removed) {
          const entry = roomClients.get(result.code)
          if (entry) entry.players.delete(result.playerId)
          clientInfo.delete(clientId)
          console.log(`[room ${result.code}] player ${result.playerId} left intentionally`)
        }
        break
      }
      case 'start-game':
        manager.startGame(clientId)
        break
      case 'cancel-start':
        manager.cancelStart(clientId)
        break
      case 'toggle-ready':
        manager.toggleReady(clientId, message.ready)
        break
      case 'kick-player': {
        const info = clientInfo.get(clientId)
        const { playerId } = manager.kickPlayer(clientId, message.playerId)
        // drop WS-layer mapping for the victim and close its socket after kick delivery
        const code = info?.code
        const entry = code ? roomClients.get(code) : undefined
        if (entry) {
          const victimClientId = entry.players.get(playerId)
          entry.players.delete(playerId)
          if (victimClientId) {
            clientInfo.delete(victimClientId)
            const victimWs = clientSockets.get(victimClientId)
            if (victimWs && victimWs.readyState === victimWs.OPEN) {
              setTimeout(() => {
                try {
                  victimWs.close(1000, 'kicked')
                } catch {}
              }, 500)
            }
          }
        }
        console.log(`[room ${code}] player ${playerId} kicked by host`)
        break
      }
      case 'host-status':
        manager.setHostStatus(clientId, message.status, message.detail)
        break
      case 'answer':
        manager.submitAnswer(clientId, message.option)
        break
      case 'chat':
        manager.sendChat(clientId, { id: message.id, text: message.text })
        break
      case 'next-question':
        manager.nextQuestion(clientId)
        break
      case 'back-to-lobby':
        manager.backToLobby(clientId)
        break
      case 'update-room-quiz':
        manager.updateRoomQuiz(clientId, {
          topic: message.topic,
          timerSeconds: message.timerSeconds,
          maxPlayers: message.maxPlayers,
          questions: message.questions,
        })
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
  // Render health checks hit the root — answer 200 so the service is never
  // restarted (and all in-memory rooms wiped) for failing a health check.
  if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  // Tab-close beacon: frees a player seat immediately (no grace hold).
  // sendBeacon posts text/plain (no CORS preflight) — parse the body as JSON.
  if (req.method === 'POST' && req.url === '/leave') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        const { code, playerId, secret } = JSON.parse(body)
        manager.leaveSeat(code, playerId, secret)
      } catch {}
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ ok: true }))
    })
    return
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const wss = new WebSocketServer({ server })

function heartbeat() {
  this.isAlive = true
  this.missedPongs = 0
}

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.missedPongs = 0
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
      console.log(`[room ${info.code}] host disconnected — grace 3 min`)
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
        // keep entry for 5 min grace; rejoin will restore
      }
      clientInfo.delete(clientId)
      console.log(`[room ${info.code}] player ${info.playerId} disconnected — grace 5 min`)
    }
  })
})

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    // tolerate one missed pong (throttled background tabs) before terminating
    if (ws.isAlive === false) {
      ws.missedPongs = (ws.missedPongs ?? 0) + 1
      if (ws.missedPongs >= 2) return ws.terminate()
    } else {
      ws.missedPongs = 0
    }
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

// more frequent grace sweep for 3 min host / 5 min player rejoin windows
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
