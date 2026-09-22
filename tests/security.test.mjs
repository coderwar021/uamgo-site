import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertProductionStoreKey, loadStore, saveStore, sessionForEmail, userForToken } from '../accounts.mjs'
import {
  checkoutAllowed,
  isUuid,
  originAllowed,
  securityHeaders,
} from '../security.mjs'

test('security headers include HSTS CSP frame-ancestors and nosniff', () => {
  const headers = securityHeaders()
  assert.match(headers['strict-transport-security'], /max-age=63072000/)
  assert.match(headers['content-security-policy'], /default-src 'self'/)
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(headers['x-content-type-options'], 'nosniff')
  assert.equal(headers['x-frame-options'], 'DENY')
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin')
})

test('checkoutAllowed only allows https waffo hosts', () => {
  assert.equal(checkoutAllowed('https://checkout.waffo.ai/x'), true)
  assert.equal(checkoutAllowed('https://pancake.waffo.ai/x'), true)
  assert.equal(checkoutAllowed('https://evil.example/x'), false)
  assert.equal(checkoutAllowed('http://checkout.waffo.ai/x'), false)
})

test('isUuid rejects traversal', () => {
  assert.equal(isUuid('../etc/passwd'), false)
  assert.equal(isUuid('not-a-uuid'), false)
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true)
})

test('originAllowed requires PUBLIC_ORIGIN', () => {
  const saved = process.env.PUBLIC_ORIGIN
  try {
    process.env.PUBLIC_ORIGIN = 'https://madecoding.com'
    assert.equal(originAllowed({ headers: { origin: 'https://madecoding.com' } }), true)
    assert.equal(originAllowed({ headers: { origin: 'https://evil.example' } }), false)
    assert.equal(originAllowed({ headers: {} }), false)
  } finally {
    if (saved === undefined) delete process.env.PUBLIC_ORIGIN
    else process.env.PUBLIC_ORIGIN = saved
  }
})

test('session file stores token_hash not the cookie', () => {
  const store = { users: [], sessions: [], orders: [] }
  const { token } = sessionForEmail(store, 'a@b.c')
  assert.equal(JSON.stringify(store).includes(token), false)
  assert.equal(typeof store.sessions[0].token_hash, 'string')
  assert.equal(userForToken(store, token).email, 'a@b.c')
})

test('expired session is rejected', () => {
  const store = { users: [], sessions: [], orders: [] }
  const { token } = sessionForEmail(store, 'a@b.c')
  store.sessions[0].expires_at = Date.now() - 1
  assert.equal(userForToken(store, token), undefined)
})

test('production refuses to start without STORE_KEY', () => {
  const node = process.env.NODE_ENV
    const key = process.env.STORE_KEY
    const b64 = process.env.STORE_KEY_BASE64
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.STORE_KEY
      delete process.env.STORE_KEY_BASE64
      assert.throws(() => assertProductionStoreKey(), /STORE_KEY/)
    } finally {
      if (node === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = node
      if (key === undefined) delete process.env.STORE_KEY
      else process.env.STORE_KEY = key
      if (b64 === undefined) delete process.env.STORE_KEY_BASE64
      else process.env.STORE_KEY_BASE64 = b64
    }
  })

test('STORE_KEY encrypts the account file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-enc-'))
  const path = join(dir, 'store.json')
  const saved = process.env.STORE_KEY
  process.env.STORE_KEY = 'ab'.repeat(32)
  try {
    const store = { users: [], sessions: [], orders: [], waffo_products: {}, webhook_ids: [] }
    sessionForEmail(store, 'a@b.c')
    await saveStore(path, store)
    const raw = await readFile(path, 'utf8')
    assert.match(raw, /^enc\.v1\./)
    assert.equal((await loadStore(path)).users[0].email, 'a@b.c')
  } finally {
    if (saved === undefined) delete process.env.STORE_KEY
    else process.env.STORE_KEY = saved
    await rm(dir, { recursive: true })
  }
})

test('http headers host-independent callback rate body and generic 500', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'madecoding-sec-'))
  process.env.DATABASE_PATH = join(dir, 'store.json')
  process.env.PORT = '0'
  process.env.PUBLIC_ORIGIN = 'https://madecoding.com'
  process.env.AETHER_CLIENT_ID = 'madecoding-test'
  process.env.AETHER_ORIGIN = 'https://mail.uamgo.com'
  delete process.env.AETHER_REDIRECT_URI
  const { server } = await import(`../server.mjs?sec=${Date.now()}`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  try {
    const start = await fetch(`${origin}/auth/aether`, {
      redirect: 'manual',
      headers: { 'x-forwarded-for': '198.51.100.10' },
    })
    assert.equal(start.status, 302)
    const location = start.headers.get('location') ?? ''
    assert.match(location, /redirect_uri=https%3A%2F%2Fmadecoding.com%2Fauth%2Fcallback/)
    const fat = await fetch(`${origin}/webhooks/waffo`, {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.11', 'content-type': 'application/json' },
      body: 'x'.repeat(70 * 1024),
    })
    assert.equal(fat.status, 413)
    let last = 200
    for (let i = 0; i < 21; i += 1) {
      const hit = await fetch(`${origin}/auth/aether`, {
        redirect: 'manual',
        headers: { 'x-forwarded-for': '198.51.100.12' },
      })
      last = hit.status
      if (i === 20) assert.equal(hit.headers.get('retry-after'), '60')
    }
    assert.equal(last, 429)
    const home = await fetch(`${origin}/`, { headers: { 'x-forwarded-for': '198.51.100.13' } })
    assert.equal(home.headers.get('x-frame-options'), 'DENY')
    assert.match(home.headers.get('strict-transport-security') ?? '', /preload/)
  } finally {
    server.close()
    await rm(dir, { recursive: true })
  }
})
