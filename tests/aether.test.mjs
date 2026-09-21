import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aetherMessage, aetherOrigin } from '../aether.mjs'

test('aetherOrigin defaults to mail.uamgo.com', () => {
  const saved = process.env.AETHER_ORIGIN
  try {
    delete process.env.AETHER_ORIGIN
    assert.equal(aetherOrigin(), 'https://mail.uamgo.com')
    process.env.AETHER_ORIGIN = 'https://mail.uamgo.com/'
    assert.equal(aetherOrigin(), 'https://mail.uamgo.com')
  } finally {
    if (saved === undefined) delete process.env.AETHER_ORIGIN
    else process.env.AETHER_ORIGIN = saved
  }
})

test('aetherMessage prefers the platform error', () => {
  assert.equal(aetherMessage({ error: '邮箱格式不正确' }, '失败'), '邮箱格式不正确')
  assert.equal(aetherMessage({}, '失败'), '失败')
})
