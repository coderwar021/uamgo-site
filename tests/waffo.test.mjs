import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MERCHANT_ID,
  DEFAULT_STORE_ID,
  merchantId,
  paymentsReady,
  privateKeyFromEnv,
  storeId,
} from '../waffo.mjs'

test('paymentsReady only needs the RSA private key', () => {
  const keys = [
    'WAFFO_MERCHANT_ID',
    'WAFFO_PRIVATE_KEY',
    'WAFFO_API_KEY',
    'WAFFO_PRIVATE_KEY_BASE64',
    'WAFFO_PRODUCT_ID',
  ]
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) delete process.env[key]
    assert.equal(paymentsReady(), false)
    assert.equal(merchantId(), DEFAULT_MERCHANT_ID)
    assert.equal(storeId(), DEFAULT_STORE_ID)
    process.env.WAFFO_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----'
    assert.equal(paymentsReady(), true)
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
})

test('privateKeyFromEnv decodes Base64 PEM', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----'
  const saved = process.env.WAFFO_PRIVATE_KEY_BASE64
  const savedPem = process.env.WAFFO_PRIVATE_KEY
  try {
    delete process.env.WAFFO_PRIVATE_KEY
    process.env.WAFFO_PRIVATE_KEY_BASE64 = Buffer.from(pem, 'utf8').toString('base64')
    assert.equal(privateKeyFromEnv(), pem)
  } finally {
    if (saved === undefined) delete process.env.WAFFO_PRIVATE_KEY_BASE64
    else process.env.WAFFO_PRIVATE_KEY_BASE64 = saved
    if (savedPem === undefined) delete process.env.WAFFO_PRIVATE_KEY
    else process.env.WAFFO_PRIVATE_KEY = savedPem
  }
})
