/**
 * GPU gateway at gateway.madecoding.com. Humans never talk to it; the site does.
 */

import { signSiteRequest, siteKeys } from './site-sign.mjs'

const DEFAULT_ORIGIN = 'https://gateway.madecoding.com'

/**
 * @returns origin without trailing slash
 */
export function rentalOrigin() {
  const given = process.env.RENTAL_ORIGIN ?? DEFAULT_ORIGIN
  return given.replace(/\/$/u, '')
}

/**
 * Mutating and credential reads need the HMAC site key.
 */
export function rentalReady() {
  return siteKeys().length > 0
}

function signedHeaders(method, path, body = '') {
  return {
    'content-type': 'application/json',
    ...signSiteRequest({ method, path, body, key: siteKeys()[0] }),
  }
}

/**
 * @param order local order
 * @param fetchImpl fetch
 * @returns created id
 */
export async function createRentalOrder(order, fetchImpl = fetch) {
  if (!rentalReady()) return order.id
  const body = JSON.stringify({
    id: order.id,
    user_id: order.user_id,
    plan_id: order.plan_id,
    hours: order.hours,
  })
  const response = await fetchImpl(`${rentalOrigin()}/orders`, {
    method: 'POST',
    headers: signedHeaders('POST', '/orders', body),
    body,
  })
  if (!response.ok) throw new Error(`rental_order_${response.status}`)
  const payload = await response.json().catch(() => ({}))
  return typeof payload.order_id === 'string' ? payload.order_id : order.id
}

/**
 * Re-post the already-verified Waffo body so the gateway can provision.
 * @param raw webhook bytes
 * @param signature X-Waffo-Signature
 * @param fetchImpl fetch
 */
export async function forwardWaffoWebhook(raw, signature, fetchImpl = fetch) {
  if (!rentalReady()) return
  const body = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8')
  await fetchImpl(`${rentalOrigin()}/webhooks/waffo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-waffo-signature': typeof signature === 'string' ? signature : '',
      ...signedHeaders('POST', '/webhooks/waffo', body),
    },
    body,
  })
}

/**
 * @param id order uuid
 * @param fetchImpl fetch
 */
export async function fetchRentalOrder(id, fetchImpl = fetch) {
  if (!rentalReady()) return undefined
  const path = `/orders/${id}`
  const response = await fetchImpl(`${rentalOrigin()}${path}`, {
    headers: signedHeaders('GET', path, ''),
  })
  if (!response.ok) return undefined
  return response.json()
}

/**
 * @param fetchImpl fetch
 */
export async function fetchRentalPlans(fetchImpl = fetch) {
  if (!rentalReady()) return undefined
  const response = await fetchImpl(`${rentalOrigin()}/plans`)
  if (!response.ok) return undefined
  const body = await response.json()
  return Array.isArray(body) ? body : undefined
}
