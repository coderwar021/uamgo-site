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

test('http register login me logout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'madecoding-site-'))
  process.env.DATABASE_PATH = join(dir, 'store.json')
  process.env.PORT = '0'
  const { server } = await import(`../server.mjs?t=${Date.now()}`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  try {
    const registered = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@made.local', password: 'long-enough' }),
    })
    assert.equal(registered.status, 201)
    const cookie = registered.headers.get('set-cookie')
    assert.match(cookie ?? '', /session=/)
    const me = await fetch(`${origin}/auth/me`, { headers: { cookie: cookie.split(';')[0] } })
    assert.deepEqual(await me.json(), { email: 'user@made.local' })
    const loggedOut = await fetch(`${origin}/auth/logout`, {
      method: 'POST',
      headers: { cookie: cookie.split(';')[0] },
    })
    assert.equal(loggedOut.status, 200)
    const empty = await fetch(`${origin}/auth/me`, { headers: { cookie: cookie.split(';')[0] } })
    assert.deepEqual(await empty.json(), { email: null })
    const login = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@made.local', password: 'long-enough' }),
    })
    assert.equal(login.status, 200)
  } finally {
    server.close()
    await rm(dir, { recursive: true })
  }
})
