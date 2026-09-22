import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aetherOrigin,
  aetherReady,
  authorizeUrl,
  createPkce,
  emailFromUserinfo,
} from '../aether.mjs'

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

test('aetherReady needs client_id', () => {
  const saved = process.env.AETHER_CLIENT_ID
  try {
    delete process.env.AETHER_CLIENT_ID
    assert.equal(aetherReady(), false)
    process.env.AETHER_CLIENT_ID = 'madecoding'
    assert.equal(aetherReady(), true)
  } finally {
    if (saved === undefined) delete process.env.AETHER_CLIENT_ID
    else process.env.AETHER_CLIENT_ID = saved
  }
})

test('authorizeUrl is Authorization Code + PKCE', () => {
  const savedId = process.env.AETHER_CLIENT_ID
  const savedOrigin = process.env.AETHER_ORIGIN
  try {
    process.env.AETHER_CLIENT_ID = 'madecoding'
    process.env.AETHER_ORIGIN = 'https://mail.uamgo.com'
    const pkce = createPkce()
    const url = new URL(authorizeUrl('https://madecoding.com/auth/callback', pkce))
    assert.equal(url.origin, 'https://mail.uamgo.com')
    assert.equal(url.pathname, '/oauth/authorize')
    assert.equal(url.searchParams.get('client_id'), 'madecoding')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('state'), pkce.state)
    assert.equal(url.searchParams.get('code_challenge'), pkce.challenge)
  } finally {
    if (savedId === undefined) delete process.env.AETHER_CLIENT_ID
    else process.env.AETHER_CLIENT_ID = savedId
    if (savedOrigin === undefined) delete process.env.AETHER_ORIGIN
    else process.env.AETHER_ORIGIN = savedOrigin
  }
})

test('emailFromUserinfo reads the email claim', () => {
  assert.equal(emailFromUserinfo({ email: 'A@B.C' }), 'a@b.c')
  assert.equal(emailFromUserinfo({}), '')
})
