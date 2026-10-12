import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { approveGrant, pollGrant, startGrant, validateApiKey } from '../cli.mjs'

test('grant start approve poll is one-shot', () => {
  const store = { users: [{ id: 'u1', email: 'a@b.c' }], cli_grants: [] }
  const started = startGrant(store)
  assert.match(started.user_code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/u)
  assert.equal(pollGrant(store, started.device_code).error, 'pending')
  assert.equal(approveGrant(store, started.user_code, 'sk-abcdefghijk', 'u1').error, undefined)
  const once = pollGrant(store, started.device_code)
  assert.equal(once.api_key, 'sk-abcdefghijk')
  assert.equal(pollGrant(store, started.device_code).error, 'expired')
  assert.equal(store.users[0].madeapi_key, 'sk-abcdefghijk')
})

test('approve rejects a missing code and a short key', () => {
  const store = { users: [{ id: 'u1' }], cli_grants: [] }
  const started = startGrant(store)
  assert.equal(validateApiKey('short'), 'key')
  assert.equal(approveGrant(store, 'XXXX-YYYY', 'sk-abcdefghijk', 'u1').error, 'code')
  assert.equal(approveGrant(store, started.user_code, 'nope', 'u1').error, 'key')
})

test('http start login approve poll', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'madecoding-cli-'))
  process.env.DATABASE_PATH = join(dir, 'store.json')
  process.env.PORT = '0'
  delete process.env.STORE_KEY
  delete process.env.STORE_KEY_BASE64
  const { server } = await import(`../server.mjs?cli=${Date.now()}`)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  process.env.PUBLIC_ORIGIN = origin
  const json = { 'content-type': 'application/json', origin }
  try {
    const page = await fetch(`${origin}/cli`)
    assert.equal(page.status, 200)
    const started = await fetch(`${origin}/cli/start`, { method: 'POST' })
    assert.equal(started.status, 200)
    const grant = await started.json()
    assert.equal(grant.verification_uri_complete, `${origin}/cli?code=${grant.user_code}`)
    const pending = await fetch(`${origin}/cli/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: grant.device_code }),
    })
    assert.equal(pending.status, 202)
    const registered = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'cli@made.local', password: 'long-enough' }),
    })
    assert.equal(registered.status, 200)
    const cookies = registered.headers.getSetCookie?.() ?? []
    const session = cookies.find((row) => row.startsWith('session='))?.split(';')[0]
    const csrf = cookies.find((row) => row.startsWith('csrf='))?.split(';')[0]
    const ready = await fetch(`${origin}/cli/ready`, { headers: { cookie: session } })
    assert.deepEqual(await ready.json(), { email: 'cli@made.local', has_key: false })
    const denied = await fetch(`${origin}/cli/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ user_code: grant.user_code, api_key: 'sk-abcdefghijk' }),
    })
    assert.equal(denied.status, 403)
    const approved = await fetch(`${origin}/cli/approve`, {
      method: 'POST',
      headers: {
        ...json,
        cookie: `${session}; ${csrf}`,
        'x-csrf-token': csrf?.slice('csrf='.length) ?? '',
      },
      body: JSON.stringify({ user_code: grant.user_code, api_key: 'sk-abcdefghijk' }),
    })
    assert.equal(approved.status, 200)
    const done = await fetch(`${origin}/cli/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: grant.device_code }),
    })
    assert.equal(done.status, 200)
    assert.deepEqual(await done.json(), { api_key: 'sk-abcdefghijk' })
    const saved = await fetch(`${origin}/cli/ready`, { headers: { cookie: session } })
    assert.deepEqual(await saved.json(), { email: 'cli@made.local', has_key: true })
  } finally {
    server.close()
    await rm(dir, { recursive: true })
  }
})
