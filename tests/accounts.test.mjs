import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  hashPassword,
  loginUser,
  normalizeEmail,
  registerUser,
  sessionForEmail,
  validateCredentials,
  verifyPassword,
} from '../accounts.mjs'

test('register then login', async () => {
  const store = { users: [], sessions: [], orders: [] }
  assert.equal(validateCredentials('a@b.c', 'short'), 'password')
  const created = await registerUser(store, 'A@B.C', 'long-enough')
  assert.equal(created.email, 'a@b.c')
  assert.equal(typeof created.token, 'string')
  assert.equal((await registerUser(store, 'a@b.c', 'long-enough')).error, 'exists')
  const again = await loginUser(store, 'a@b.c', 'long-enough')
  assert.equal(again.email, 'a@b.c')
  assert.equal((await loginUser(store, 'a@b.c', 'wrong-password')).error, 'credentials')
})

test('scrypt round trip', async () => {
  const stored = await hashPassword('long-enough')
  assert.equal(await verifyPassword('long-enough', stored), true)
  assert.equal(await verifyPassword('nope-nope', stored), false)
  assert.equal(normalizeEmail('  X@Y.Z '), 'x@y.z')
})

test('sessionForEmail reuses the same user', () => {
  const store = { users: [], sessions: [], orders: [] }
  const first = sessionForEmail(store, 'A@B.C')
  const second = sessionForEmail(store, 'a@b.c')
  assert.equal(first.email, 'a@b.c')
  assert.equal(store.users.length, 1)
  assert.equal(store.sessions.length, 2)
  assert.notEqual(first.token, second.token)
})

test('http OAuth callback then me logout', async () => {
  const mock = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://aether.test')
    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ access_token: 'tok_test', token_type: 'Bearer' }))
      return
    }
    if (request.method === 'GET' && url.pathname === '/oauth/userinfo') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ email: 'user@made.local', sub: '1' }))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const aetherPort = mock.address().port
  process.env.AETHER_ORIGIN = `http://127.0.0.1:${aetherPort}`
  process.env.AETHER_CLIENT_ID = 'madecoding-test'
  const dir = await mkdtemp(join(tmpdir(), 'madecoding-site-'))
  process.env.DATABASE_PATH = join(dir, 'store.json')
  process.env.PORT = '0'
  const { server } = await import(`../server.mjs?t=${Date.now()}`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  process.env.AETHER_REDIRECT_URI = `${origin}/auth/callback`
  try {
    const start = await fetch(`${origin}/auth/aether`, { redirect: 'manual' })
    assert.equal(start.status, 302)
    const location = start.headers.get('location') ?? ''
    assert.match(location, /\/oauth\/authorize/)
    const setCookie = start.headers.getSetCookie?.() ?? []
    const jar = setCookie.map((row) => row.split(';')[0]).join('; ')
    const authorize = new URL(location)
    const callback = await fetch(
      `${origin}/auth/callback?code=abc&state=${authorize.searchParams.get('state')}`,
      { redirect: 'manual', headers: { cookie: jar } },
    )
    assert.equal(callback.status, 302)
    const session = (callback.headers.getSetCookie?.() ?? [])
      .find((row) => row.startsWith('session='))
      ?.split(';')[0]
    assert.match(session ?? '', /session=/)
    const me = await fetch(`${origin}/auth/me`, { headers: { cookie: session } })
    assert.deepEqual(await me.json(), { email: 'user@made.local' })
    const loggedOut = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { cookie: session },
    })
    assert.equal(loggedOut.status, 200)
    const empty = await fetch(`${origin}/auth/me`, { headers: { cookie: session } })
    assert.deepEqual(await empty.json(), { email: null })
    const webhook = await fetch(`${origin}/webhooks/waffo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(webhook.status, 401)
  } finally {
    server.close()
    mock.close()
    await rm(dir, { recursive: true })
  }
})
