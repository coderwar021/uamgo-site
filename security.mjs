import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Canonical public origin. Read at call time so tests can set PUBLIC_ORIGIN.
 * @returns origin without trailing slash
 */
export function canonicalOrigin() {
  return (process.env.PUBLIC_ORIGIN ?? 'https://madecoding.com').replace(/\/$/u, '')
}

export const CANONICAL_ORIGIN = canonicalOrigin()

const AUTH_LIMIT = createLimiter(60_000, 20)
const ORDER_LIMIT = createLimiter(60_000, 30)
const WEBHOOK_LIMIT = createLimiter(60_000, 120)

/**
 * @param windowMs window
 * @param max hits per window
 */
export function createLimiter(windowMs, max) {
  const hits = new Map()
  return function allow(key) {
    const now = Date.now()
    if (hits.size > 20_000) {
      for (const [id, row] of hits) {
        if (now >= row.reset) hits.delete(id)
      }
    }
    const row = hits.get(key)
    if (row === undefined || now >= row.reset) {
      hits.set(key, { count: 1, reset: now + windowMs })
      return true
    }
    if (row.count >= max) return false
    row.count += 1
    return true
  }
}

/**
 * SHA-256 hex of a secret. Used so the session file never stores the cookie value.
 * @param value secret
 * @returns hex digest
 */
export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Constant-time string compare. Mismatched lengths still compare dummy hashes.
 * @param left first
 * @param right second
 * @returns whether equal
 */
export function safeEqual(left, right) {
  const a = sha256Hex(String(left ?? ''))
  const b = sha256Hex(String(right ?? ''))
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/**
 * Client IP. Prefer Cloudflare / proxy headers Railway actually sets.
 * @param request incoming
 * @returns ip
 */
export function clientIp(request) {
  const cf = request.headers['cf-connecting-ip']
  if (typeof cf === 'string' && cf.length > 0) return cf.trim()
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  return request.socket?.remoteAddress ?? '0.0.0.0'
}

/**
 * @param request incoming
 * @param kind auth | order | webhook
 * @returns whether under quota
 */
export function rateOk(request, kind) {
  const ip = clientIp(request)
  if (kind === 'auth') return AUTH_LIMIT(ip)
  if (kind === 'order') return ORDER_LIMIT(ip)
  return WEBHOOK_LIMIT(ip)
}

/**
 * Browser Origin / Referer must be this site. Blocks CSRF from other hosts.
 * @param request incoming
 * @returns whether the call is same-site
 */
export function originAllowed(request) {
  const allowed = new URL(canonicalOrigin())
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const got = new URL(origin)
      return got.protocol === allowed.protocol && got.host === allowed.host
    } catch {
      return false
    }
  }
  const referer = request.headers.referer
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const got = new URL(referer)
      return got.protocol === allowed.protocol && got.host === allowed.host
    } catch {
      return false
    }
  }
  return false
}

/**
 * Hosted checkout hosts Waffo actually serves. Anything else is dropped.
 * @param url checkout URL
 * @returns whether safe to open
 */
export function checkoutAllowed(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false
  try {
    const host = new URL(url).hostname
    return host === 'checkout.waffo.ai' || host === 'pancake.waffo.ai'
      || host.endsWith('.waffo.ai')
  } catch {
    return false
  }
}

/**
 * Chromium / Edge / Safari baseline headers.
 * @returns header map
 */
export function securityHeaders() {
  return {
    'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
    'cache-control': 'no-store',
  }
}

/**
 * Inject security headers into every writeHead.
 * @param response outgoing
 */
export function lockResponse(response) {
  if (response.__madecodingLocked) return
  response.__madecodingLocked = true
  const original = response.writeHead.bind(response)
  response.writeHead = (...args) => {
    const status = args[0]
    const message = typeof args[1] === 'string' ? args[1] : undefined
    const given = (typeof args[1] === 'object' ? args[1] : args[2]) ?? {}
    const merged = { ...securityHeaders(), ...given }
    if (message === undefined) return original(status, merged)
    return original(status, message, merged)
  }
}

/**
 * UUID v4 path segment. Rejects `../` and arbitrary ids.
 * @param value path id
 * @returns whether allowed
 */
export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

const MAX_BODY = 64 * 1024

/**
 * @param request incoming
 * @returns utf8 body or throws if too large
 */
export async function readLimited(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) {
      const error = new Error('payload_too_large')
      error.code = 'payload_too_large'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
