import { createHmac, randomBytes } from 'node:crypto'
import { safeEqual, sha256Hex } from './security.mjs'

export const SIGN_WINDOW_MS = 300_000

const nonces = new Map()

/**
 * @returns configured site HMAC secrets, current then next
 */
export function siteKeys() {
  return [process.env.RENTAL_SITE_KEY, process.env.RENTAL_SITE_KEY_NEXT]
    .filter((value) => typeof value === 'string' && value.length > 0)
}

/**
 * Canonical string for HMAC: method, path, timestamp, nonce, body hash.
 * @param method HTTP method
 * @param path URL path
 * @param timestamp unix ms
 * @param nonce hex nonce
 * @param body raw body
 */
export function canonicalSitePayload(method, path, timestamp, nonce, body) {
  const hash = sha256Hex(typeof body === 'string' ? body : Buffer.from(body ?? '').toString('utf8'))
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${hash}`
}

/**
 * @param input request pieces
 * @returns headers to attach
 */
export function signSiteRequest(input) {
  const key = input.key ?? siteKeys()[0] ?? ''
  const timestamp = String(input.now ?? Date.now())
  const nonce = input.nonce ?? randomBytes(16).toString('hex')
  const payload = canonicalSitePayload(input.method, input.path, timestamp, nonce, input.body ?? '')
  const signature = createHmac('sha256', key).update(payload).digest('hex')
  return {
    'x-site-timestamp': timestamp,
    'x-site-nonce': nonce,
    'x-site-signature': signature,
  }
}

function pruneNonces(now) {
  if (nonces.size <= 20_000) {
    for (const [id, until] of nonces) {
      if (now >= until) nonces.delete(id)
    }
    return
  }
  for (const [id, until] of nonces) {
    if (now >= until) nonces.delete(id)
  }
}

/**
 * Verify HMAC from the site. Accepts RENTAL_SITE_KEY or RENTAL_SITE_KEY_NEXT.
 * Rejects expired timestamps and replayed nonces.
 * @param request incoming
 * @param body raw body
 * @returns whether the signature is valid
 */
export function siteSignatureOk(request, body = '') {
  const keys = siteKeys()
  if (keys.length === 0) return false
  const timestamp = request.headers['x-site-timestamp']
  const nonce = request.headers['x-site-nonce']
  const signature = request.headers['x-site-signature']
  if (typeof timestamp !== 'string' || typeof nonce !== 'string' || typeof signature !== 'string') {
    return false
  }
  if (!/^[0-9]{1,16}$/u.test(timestamp)) return false
  if (!/^[0-9a-f]{16,64}$/iu.test(nonce)) return false
  const now = Date.now()
  if (Math.abs(now - Number(timestamp)) > SIGN_WINDOW_MS) return false
  pruneNonces(now)
  if (nonces.has(nonce)) return false
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const payload = canonicalSitePayload(request.method ?? 'GET', path, timestamp, nonce, body)
  let ok = false
  for (const key of keys) {
    const expected = createHmac('sha256', key).update(payload).digest('hex')
    if (safeEqual(expected, signature)) ok = true
  }
  if (!ok) return false
  nonces.set(nonce, now + SIGN_WINDOW_MS)
  return true
}

/** Test helper: drop the nonce cache. */
export function resetSiteNonces() {
  nonces.clear()
}
