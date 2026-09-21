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

test('http register login me logout via Aether OTP', async () => {
  const mock = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://aether.test')
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      response.setHeader('content-type', 'application/json')
      if (url.pathname === '/api/auth/send-otp') {
        response.end(JSON.stringify({ ok: true }))
        return
      }
      if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/login') {
        if (body.code === '123456') {
          response.end(JSON.stringify({ ok: true }))
          return
        }
        response.statusCode = 401
        response.end(JSON.stringify({ error: '账号或密码错误' }))
        return
      }
      response.statusCode = 404
      response.end('{}')
    })
  })
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const aetherPort = mock.address().port
  process.env.AETHER_ORIGIN = `http://127.0.0.1:${aetherPort}`
  const dir = await mkdtemp(join(tmpdir(), 'madecoding-site-'))
  process.env.DATABASE_PATH = join(dir, 'store.json')
  process.env.PORT = '0'
  const { server } = await import(`../server.mjs?t=${Date.now()}`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  try {
    const otp = await fetch(`${origin}/auth/otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@made.local', purpose: 'register' }),
    })
    assert.equal(otp.status, 200)
    const registered = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@made.local',
        password: 'long-enough',
        confirmPassword: 'long-enough',
        name: 'User',
        code: '123456',
      }),
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
      body: JSON.stringify({ email: 'user@made.local', password: 'long-enough', code: '123456' }),
    })
    assert.equal(login.status, 200)
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
