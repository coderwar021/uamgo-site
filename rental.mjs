/**
 * GPU gateway at gateway.madecoding.com. Humans never talk to it; the site does.
 */

const DEFAULT_ORIGIN = 'https://gateway.madecoding.com'

/**
 * @returns origin without trailing slash
 */
export function rentalOrigin() {
  const given = process.env.RENTAL_ORIGIN ?? DEFAULT_ORIGIN
  return given.replace(/\/$/u, '')
}

/**
 * Mutating and credential reads need the shared site key.
 */
export function rentalReady() {
  return (process.env.RENTAL_SITE_KEY ?? '').length > 0
}

function siteHeaders() {
  return {
    'content-type': 'application/json',
    'x-site-key': process.env.RENTAL_SITE_KEY ?? '',
  }
}

/**
 * @param order local order
 * @param fetchImpl fetch
 * @returns created id
 */
export async function createRentalOrder(order, fetchImpl = fetch) {
  if (!rentalReady()) return order.id
  const response = await fetchImpl(`${rentalOrigin()}/orders`, {
    method: 'POST',
    headers: siteHeaders(),
    body: JSON.stringify({
      id: order.id,
      user_id: order.user_id,
      plan_id: order.plan_id,
      hours: order.hours,
    }),
  })
  if (!response.ok) throw new Error(`rental_order_${response.status}`)
  const body = await response.json().catch(() => ({}))
  return typeof body.order_id === 'string' ? body.order_id : order.id
}

/**
 * Re-post the already-verified Waffo body so the gateway can provision.
 * @param raw webhook bytes
 * @param signature X-Waffo-Signature
 * @param fetchImpl fetch
 */
export async function forwardWaffoWebhook(raw, signature, fetchImpl = fetch) {
  if (!rentalReady()) return
  await fetchImpl(`${rentalOrigin()}/webhooks/waffo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-waffo-signature': typeof signature === 'string' ? signature : '',
    },
    body: raw,
  })
}

/**
 * @param id order uuid
 * @param fetchImpl fetch
 */
export async function fetchRentalOrder(id, fetchImpl = fetch) {
  if (!rentalReady()) return undefined
  const response = await fetchImpl(`${rentalOrigin()}/orders/${id}`, {
    headers: { 'x-site-key': process.env.RENTAL_SITE_KEY ?? '' },
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
