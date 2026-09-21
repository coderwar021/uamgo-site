import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import {
  bodySha256Base64,
  paymentsReady,
  pemFromEnv,
  signWaffoRequest,
} from '../waffo.mjs'

test('paymentsReady needs merchant, private key, and product', () => {
  const keys = [
    'WAFFO_MERCHANT_ID',
    'WAFFO_PRIVATE_KEY',
    'WAFFO_API_KEY',
    'WAFFO_PRODUCT_ID',
    'WAFFO_STORE_SLUG',
    'WAFFO_PRODUCT_GROUP5',
    'WAFFO_PRODUCT_GROUP6',
  ]
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) delete process.env[key]
    assert.equal(paymentsReady(), false)
    process.env.WAFFO_STORE_SLUG = 'ignored'
    process.env.WAFFO_PRODUCT_ID = 'PROD_x'
    assert.equal(paymentsReady(), false)
    process.env.WAFFO_MERCHANT_ID = 'MER_x'
    process.env.WAFFO_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'
    assert.equal(paymentsReady(), true)
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})

test('pemFromEnv expands escaped newlines', () => {
  const pem = pemFromEnv('-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----')
  assert.equal(pem.includes('\nABC\n'), true)
})

test('API Key signature verifies against the canonical string', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const body = '{"productId":"PROD_x","currency":"CNY"}'
  const timestamp = '1711800000'
  const signature = signWaffoRequest(
    'POST',
    '/v1/actions/checkout/create-session',
    timestamp,
    body,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  )
  const canonical = `POST\n/v1/actions/checkout/create-session\n${timestamp}\n${bodySha256Base64(body)}`
  const verify = createVerify('sha256')
  verify.update(canonical, 'utf8')
  verify.end()
  assert.equal(verify.verify(publicKey, signature, 'base64'), true)
})
