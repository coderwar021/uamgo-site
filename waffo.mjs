import {
  TaxCategory,
  WaffoPancake,
  WaffoPancakeError,
  WebhookEventType,
  verifyWebhook,
} from '@waffo/pancake-ts'
import { checkoutAllowed } from './security.mjs'

/** Dashboard → API 与开发. Not a secret; override with WAFFO_MERCHANT_ID. */
export const DEFAULT_MERCHANT_ID = 'MER_24yDgYwX9MaPwheVAyCk3d'

/** Dashboard → 设置 → 店铺资料. Override with WAFFO_STORE_ID. */
export const DEFAULT_STORE_ID = 'STO_1WjWkflwKXm3BodanakF0J'

const SUCCESS_URL = 'https://madecoding.com/deploy'
const WEBHOOK_URL = 'https://madecoding.com/webhooks/waffo'

/**
 * RSA PEM from env. Supports PEM, escaped newlines, or Base64 of the whole PEM.
 * @returns private key or empty
 */
export function privateKeyFromEnv() {
  const b64 = process.env.WAFFO_PRIVATE_KEY_BASE64 ?? ''
  if (b64.length > 0) {
    return Buffer.from(b64, 'base64').toString('utf8')
  }
  return (process.env.WAFFO_PRIVATE_KEY ?? process.env.WAFFO_API_KEY ?? '').trim()
}

/**
 * @returns Merchant ID
 */
export function merchantId() {
  const value = process.env.WAFFO_MERCHANT_ID ?? ''
  return value.length > 0 ? value : DEFAULT_MERCHANT_ID
}

/**
 * @returns Store ID
 */
export function storeId() {
  const value = process.env.WAFFO_STORE_ID ?? ''
  return value.length > 0 ? value : DEFAULT_STORE_ID
}

/**
 * SDK client. Private key stays in env; the SDK signs every request.
 * @returns Waffo Pancake client
 */
export function pancakeClient() {
  return new WaffoPancake({
    merchantId: merchantId(),
    privateKey: privateKeyFromEnv(),
  })
}

/**
 * Merchant API Key is configured when the RSA private key is present.
 * @returns whether checkout can run
 */
export function paymentsReady() {
  return privateKeyFromEnv().length > 0
}

/**
 * @param planId group5 | group6
 * @returns env product id or empty
 */
export function productIdFromEnv(planId) {
  const named = process.env[`WAFFO_PRODUCT_${planId.toUpperCase()}`]
  if (typeof named === 'string' && named.length > 0) return named
  return process.env.WAFFO_PRODUCT_ID ?? ''
}

/**
 * Create a one-time GPU-hour product on the existing store, then publish to prod.
 * @param plan catalog row
 * @returns product id
 */
export async function ensureOnetimeProduct(plan) {
  const client = pancakeClient()
  const { product } = await client.onetimeProducts.create({
    storeId: storeId(),
    name: plan.name,
    description: `madecoding GPU 小时 · ${plan.name}`,
    successUrl: SUCCESS_URL,
    metadata: { plan_id: plan.id },
    prices: {
      CNY: {
        amount: plan.price_cny_per_hour.toFixed(2),
        taxCategory: TaxCategory.DigitalGoods,
      },
    },
  })
  try {
    await client.onetimeProducts.publish({ id: product.id })
  } catch (error) {
    if (!(error instanceof WaffoPancakeError)) throw error
  }
  return product.id
}

/**
 * Register the production HTTP webhook once. Duplicate URLs are ignored.
 * @returns void
 */
export async function ensureHttpWebhook() {
  const client = pancakeClient()
  const url = process.env.WAFFO_WEBHOOK_URL ?? WEBHOOK_URL
  try {
    await client.webhooks.add({
      storeId: storeId(),
      channel: 'http',
      url,
      events: [WebhookEventType.OrderCompleted],
      testMode: false,
    })
  } catch (error) {
    if (!(error instanceof WaffoPancakeError)) throw error
  }
}

/**
 * Hosted checkout via @waffo/pancake-ts (no hand-rolled RSA).
 * @param order stored order
 * @param email buyer email
 * @param planHoursPriceCny price per hour
 * @param productId PROD_ id
 * @returns checkout URL or Waffo error text
 */
export async function createWaffoCheckout(order, email, planHoursPriceCny, productId) {
  if (productId.length === 0) {
    return { checkout: undefined, error: 'missing_product' }
  }
  const amount = (planHoursPriceCny * order.hours).toFixed(2)
  try {
    const session = await pancakeClient().checkout.createSession({
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
        taxCategory: TaxCategory.DigitalGoods,
      },
      successUrl: `${SUCCESS_URL}?order=${order.id}`,
      language: 'zh-Hans',
    })
    const url = session.checkoutUrl
    if (checkoutAllowed(url)) {
      return { checkout: url, error: undefined }
    }
    return { checkout: undefined, error: typeof url === 'string' ? 'checkout_host' : 'no_checkout_url' }
  } catch (error) {
    if (error instanceof WaffoPancakeError) {
      const message = error.errors[0]?.message
      return {
        checkout: undefined,
        error: typeof message === 'string' && message.length > 0
          ? message
          : `HTTP ${error.status}`,
      }
    }
    throw error
  }
}

/**
 * Verify a Waffo webhook with embedded platform public keys (prod first).
 * @param rawBody unparsed request body
 * @param signatureHeader X-Waffo-Signature
 * @returns parsed event
 */
export function verifyWaffoWebhook(rawBody, signatureHeader) {
  return verifyWebhook(rawBody, signatureHeader, { environment: 'prod' })
}
