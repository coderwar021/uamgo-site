import assert from 'node:assert/strict'
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
  assert.equal((await loginUser(store, 'missing@b.c', 'long-enough')).error, 'credentials')
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

test('register sets a password on a passwordless row', async () => {
  const store = { users: [], sessions: [], orders: [] }
  sessionForEmail(store, 'old@b.c')
  assert.equal((await loginUser(store, 'old@b.c', 'long-enough')).error, 'credentials')
  const claimed = await registerUser(store, 'old@b.c', 'long-enough')
  assert.equal(claimed.email, 'old@b.c')
  assert.equal(store.users.length, 1)
  assert.equal((await loginUser(store, 'old@b.c', 'long-enough')).email, 'old@b.c')
})

test('http register login me logout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'madecoding-site-'))
  process.env.DATABASE_PATH = join(dir, 'store.json')
  process.env.PORT = '0'
  delete process.env.STORE_KEY
  delete process.env.STORE_KEY_BASE64
  const { server } = await import(`../server.mjs?t=${Date.now()}`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  process.env.PUBLIC_ORIGIN = origin
  const json = { 'content-type': 'application/json', origin }
  try {
    const aether = await fetch(`${origin}/auth/aether`, { redirect: 'manual' })
    assert.equal(aether.status, 404)
    const cross = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'user@made.local', password: 'long-enough' }),
    })
    assert.equal(cross.status, 403)
    const registered = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'user@made.local', password: 'long-enough' }),
    })
    assert.equal(registered.status, 200)
    assert.deepEqual(await registered.json(), { email: 'user@made.local' })
    const again = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'user@made.local', password: 'long-enough' }),
    })
    assert.equal(again.status, 409)
    const wrong = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'user@made.local', password: 'wrong-password' }),
    })
    assert.equal(wrong.status, 401)
    const loggedIn = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'User@Made.local', password: 'long-enough' }),
    })
    assert.equal(loggedIn.status, 200)
    const cookies = loggedIn.headers.getSetCookie?.() ?? []
    const session = cookies.find((row) => row.startsWith('session='))?.split(';')[0]
    const csrf = cookies.find((row) => row.startsWith('csrf='))?.split(';')[0]
    assert.match(session ?? '', /session=/)
    const me = await fetch(`${origin}/auth/me`, { headers: { cookie: session } })
    assert.deepEqual(await me.json(), { email: 'user@made.local' })
    const denied = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { cookie: `${session}; ${csrf}` },
    })
    assert.equal(denied.status, 403)
    const loggedOut = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${session}; ${csrf}`,
        origin,
        'x-csrf-token': csrf?.slice('csrf='.length) ?? '',
      },
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
    const badId = await fetch(`${origin}/orders/../secret`)
    assert.equal(badId.status, 404)
    const home = await fetch(`${origin}/`)
    assert.match(home.headers.get('content-security-policy') ?? '', /default-src 'self'/)
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff')
  } finally {
    server.close()
    await rm(dir, { recursive: true })
  }
})
