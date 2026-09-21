import { createHash, createSign } from 'node:crypto'

const CHECKOUT_PATH = '/v1/actions/checkout/create-session'
const CHECKOUT_URL = `https://api.waffo.ai${CHECKOUT_PATH}`

/**
 * PEM from Railway/env. Literal `\n` sequences become real newlines.
 * @param raw env value
 * @returns private key PEM
 */
export function pemFromEnv(raw) {
  const key = raw.trim().replace(/\\n/g, '\n')
  if (key.includes('BEGIN')) return key
  return `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`
}

/**
 * SHA-256 of the exact JSON body, Base64.
 * @param bodyJson exact POST body
 * @returns digest
 */
export function bodySha256Base64(bodyJson) {
  return createHash('sha256').update(bodyJson, 'utf8').digest('base64')
}

/**
 * RSA-SHA256 PKCS1v15 signature, Base64, of METHOD\\nPATH\\nts\\nbodyHash.
 * @param method HTTP method
 * @param path path
 * @param timestamp unix seconds
 * @param bodyJson exact JSON string
 * @param privateKeyPem PEM
 * @returns Base64 signature
 */
export function signWaffoRequest(method, path, timestamp, bodyJson, privateKeyPem) {
  const canonical = `${method}\n${path}\n${timestamp}\n${bodySha256Base64(bodyJson)}`
  const signer = createSign('sha256')
  signer.update(canonical, 'utf8')
  signer.end()
  return signer.sign(pemFromEnv(privateKeyPem), 'base64')
}

/**
 * Merchant id plus downloaded RSA private key (Waffo API Key auth).
 * @returns whether checkout can be signed
 */
export function paymentsReady() {
  const merchant = process.env.WAFFO_MERCHANT_ID ?? ''
  const key = process.env.WAFFO_PRIVATE_KEY ?? process.env.WAFFO_API_KEY ?? ''
  const product = process.env.WAFFO_PRODUCT_ID
    ?? process.env.WAFFO_PRODUCT_GROUP5
    ?? process.env.WAFFO_PRODUCT_GROUP6
    ?? ''
  return merchant.length > 0 && key.length > 0 && product.length > 0
}

/**
 * @param planId group5 | group6
 * @returns PROD_ id
 */
export function productForPlan(planId) {
  const named = process.env[`WAFFO_PRODUCT_${planId.toUpperCase()}`]
  if (typeof named === 'string' && named.length > 0) return named
  return process.env.WAFFO_PRODUCT_ID ?? ''
}

/**
 * Create a Waffo checkout session with API Key headers (not Store Slug).
 * @param order stored order
 * @param email buyer email
 * @param planHoursPriceCny price per hour
 * @returns checkout URL or Waffo error text
 */
export async function createWaffoCheckout(order, email, planHoursPriceCny) {
  const merchantId = process.env.WAFFO_MERCHANT_ID ?? ''
  const privateKey = process.env.WAFFO_PRIVATE_KEY ?? process.env.WAFFO_API_KEY ?? ''
  const productId = productForPlan(order.plan_id)
  if (merchantId.length === 0 || privateKey.length === 0 || productId.length === 0) {
    return { checkout: undefined, error: 'missing_credentials' }
  }
  const amount = (planHoursPriceCny * order.hours).toFixed(2)
  const payload = {
    productId,
    currency: process.env.WAFFO_CURRENCY ?? 'CNY',
    buyerEmail: email,
    orderMerchantExternalId: order.id,
    metadata: {
      order_id: order.id,
      plan_id: order.plan_id,
      hours: String(order.hours),
    },
    priceSnapshot: {
      amount,
      taxIncluded: true,
      taxCategory: process.env.WAFFO_TAX_CATEGORY ?? 'digital_goods',
    },
    successUrl: `https://madecoding.com/deploy?order=${order.id}`,
    language: 'zh-Hans',
  }
  const bodyJson = JSON.stringify(payload)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = signWaffoRequest('POST', CHECKOUT_PATH, timestamp, bodyJson, privateKey)
  const response = await fetch(CHECKOUT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Merchant-Id': merchantId,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
    },
    body: bodyJson,
  })
  const json = await response.json().catch(() => ({}))
  const url = json?.data?.checkoutUrl
  if (typeof url === 'string' && url.startsWith('https://')) {
    return { checkout: url, error: undefined }
  }
  const message = json?.errors?.[0]?.message
  return {
    checkout: undefined,
    error: typeof message === 'string' && message.length > 0
      ? message
      : `HTTP ${response.status}`,
  }
}
