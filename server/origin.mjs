function tryUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Parse the ALLOWED_ORIGINS env value ("https://a.example, b.local") into a
 * lookup set. Full URLs contribute both their origin and hostname so either
 * spelling matches; bare hostnames pass through untouched.
 */
export function parseAllowedOrigins(raw) {
  const allowed = new Set()
  for (const entry of (raw ?? '').split(',')) {
    const value = entry.trim()
    if (!value) continue
    const url = tryUrl(value)
    if (url) {
      allowed.add(url.hostname)
      allowed.add(url.origin)
    } else {
      allowed.add(value)
    }
  }
  return allowed
}

/**
 * Cross-Site WebSocket Hijacking guard. Browsers do not preflight WebSocket
 * upgrades, so any page the user visits could dial the room server. Allow when
 * there is no Origin (non-browser client), when the Origin's hostname matches
 * the Host header's hostname (same host: local dev, same-domain deploy), or
 * when it is explicitly allowlisted. Port-insensitive on purpose: the vite dev
 * page (:5173) dials the room server (:8787) on the same address.
 *
 * A split deploy (SPA on Vercel, room server on Render) is cross-origin, so its
 * page origin must be listed in ALLOWED_ORIGINS.
 */
export function isOriginAllowed(origin, host, allowedOrigins) {
  if (!origin) return true
  const originUrl = tryUrl(origin)
  if (!originUrl) return false
  if (allowedOrigins.has(originUrl.hostname) || allowedOrigins.has(originUrl.origin)) {
    return true
  }
  const hostUrl = tryUrl(`http://${host ?? ''}`)
  return hostUrl !== null && originUrl.hostname === hostUrl.hostname
}
