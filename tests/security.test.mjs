import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertPersistentStore,
  assertProductionStoreKey,
  isProduction,
  loadStore,
  resolveDatabasePath,
  saveStore,
  sessionForEmail,
  SESSION_CAP,
  SESSION_IDLE,
  userForToken,
} from '../accounts.mjs'
import { audit, hashEmail } from '../audit.mjs'
import { accountOrderOk, checkoutAllowed, clientIp, isUuid, originAllowed, securityHeaders } from '../security.mjs'
import { resetSiteNonces, SIGN_WINDOW_MS, signSiteRequest, siteSignatureOk } from '../site-sign.mjs'

test('security headers include HSTS CSP frame-ancestors and nosniff', () => {
  const headers = securityHeaders()
  assert.match(headers['strict-transport-security'], /max-age=63072000/)
  assert.match(headers['content-security-policy'], /default-src 'self'/)
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(headers['x-content-type-options'], 'nosniff')
  assert.equal(headers['x-frame-options'], 'DENY')
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin')
  assert.match(headers['permissions-policy'], /camera=\(\)/)
})

test('clientIp uses Cloudflare, never a spoofed X-Forwarded-For', () => {
  assert.equal(clientIp({
    headers: { 'cf-connecting-ip': '203.0.113.9', 'x-real-ip': '104.16.1.1', 'x-forwarded-for': '1.2.3.4' },
  }), '203.0.113.9')
  assert.equal(clientIp({
    headers: { 'x-forwarded-for': '1.2.3.4' },
    socket: { remoteAddress: '127.0.0.1' },
  }), '127.0.0.1')
})

test('a spoofed cf-connecting-ip is ignored unless the hop is Cloudflare', () => {
  assert.equal(clientIp({
    headers: { 'cf-connecting-ip': '198.51.100.1', 'x-real-ip': '8.8.8.8' },
  }), '8.8.8.8')
  assert.equal(clientIp({
    headers: { 'cf-connecting-ip': '198.51.100.1' },
    socket: { remoteAddress: '127.0.0.1' },
  }), '127.0.0.1')
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

test('a Railway deployment counts as production without NODE_ENV', () => {
  assert.equal(isProduction({}), false)
  assert.equal(isProduction({ NODE_ENV: 'production' }), true)
  assert.equal(isProduction({ RAILWAY_ENVIRONMENT_NAME: 'production' }), true)
})

test('the account file lives on the Railway volume', () => {
  assert.equal(resolveDatabasePath({ RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }, '/tmp/x.json'), '/app/data/store.json')
  assert.equal(
    resolveDatabasePath({ DATABASE_PATH: '/srv/a.json', RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }, '/tmp/x.json'),
    '/srv/a.json',
  )
  assert.equal(resolveDatabasePath({}, '/tmp/x.json'), '/tmp/x.json')
})

test('Railway refuses to start when account data would be lost on redeploy', () => {
  const railway = { RAILWAY_ENVIRONMENT_NAME: 'production' }
  assert.throws(() => assertPersistentStore(railway, '/app/data/store.json'), /volume required/)
  assert.throws(
    () => assertPersistentStore({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }, '/app/store.json'),
    /outside the Railway volume/,
  )
  assert.throws(
    () => assertPersistentStore({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }, '/app/database/store.json'),
    /outside the Railway volume/,
  )
  assertPersistentStore({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }, '/app/data/store.json')
  assertPersistentStore({}, '/tmp/store.json')
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
    assert.match(raw, /^enc\.v2\.[0-9a-f]{8}\./)
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
        headers: { 'cf-connecting-ip': '198.51.100.10', 'x-real-ip': '104.16.1.1' },
    })
    assert.equal(start.status, 302)
    const location = start.headers.get('location') ?? ''
    assert.match(location, /redirect_uri=https%3A%2F%2Fmadecoding.com%2Fauth%2Fcallback/)
    const fat = await fetch(`${origin}/webhooks/waffo`, {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.11', 'x-real-ip': '104.16.1.1', 'content-type': 'application/json' },
      body: 'x'.repeat(70 * 1024),
    })
    assert.equal(fat.status, 413)
    let last = 200
    for (let i = 0; i < 21; i += 1) {
      const hit = await fetch(`${origin}/auth/aether`, {
        redirect: 'manual',
        headers: { 'cf-connecting-ip': '198.51.100.12', 'x-real-ip': '104.16.1.1' },
      })
      last = hit.status
      if (i === 20) assert.equal(hit.headers.get('retry-after'), '60')
    }
    assert.equal(last, 429)
    const txt = await fetch(`${origin}/.well-known/security.txt`)
    assert.match(await txt.text(), /Contact: mailto:security@madecoding.com/)
    const home = await fetch(`${origin}/`, { headers: { 'cf-connecting-ip': '198.51.100.13', 'x-real-ip': '104.16.1.1' } })
    assert.equal(home.headers.get('x-frame-options'), 'DENY')
    assert.match(home.headers.get('strict-transport-security') ?? '', /preload/)
  } finally {
    server.close()
    await rm(dir, { recursive: true })
  }
})

test('idle sessions expire after two hours', () => {
  const store = { users: [], sessions: [], orders: [] }
  const { token } = sessionForEmail(store, 'a@b.c')
  store.sessions[0].seen_at = Date.now() - SESSION_IDLE * 1000 - 1
  assert.equal(userForToken(store, token), undefined)
})

test('a sixth login drops the oldest session', () => {
  const store = { users: [], sessions: [], orders: [] }
  const tokens = []
  for (let i = 0; i < SESSION_CAP + 1; i += 1) tokens.push(sessionForEmail(store, 'a@b.c').token)
  assert.equal(store.sessions.length, SESSION_CAP)
  assert.equal(userForToken(store, tokens[0]), undefined)
  assert.equal(userForToken(store, tokens[SESSION_CAP]).email, 'a@b.c')
})

test('saveStore drops expired sessions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sess-purge-'))
  const path = join(dir, 'store.json')
  const store = { users: [], sessions: [], orders: [], waffo_products: {}, webhook_ids: [] }
  sessionForEmail(store, 'a@b.c')
  store.sessions[0].expires_at = Date.now() - 1
  await saveStore(path, store)
  assert.equal((await loadStore(path)).sessions.length, 0)
  await rm(dir, { recursive: true })
})

test('STORE_KEY_PREVIOUS reads v1 and v2 then writes v2 with the current key', async () => {
  const { createCipheriv, randomBytes } = await import('node:crypto')
  const dir = await mkdtemp(join(tmpdir(), 'store-rot-'))
  const path = join(dir, 'store.json')
  const oldKey = 'cd'.repeat(32)
  const newKey = 'ab'.repeat(32)
  const key = Buffer.from(oldKey, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const json = `${JSON.stringify({ users: [{ id: '1', email: 'a@b.c' }], sessions: [], orders: [], waffo_products: {}, webhook_ids: [] }, null, 2)}\n`
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  await writeFile(path, `enc.v1.${Buffer.concat([iv, tag, encrypted]).toString('base64')}\n`)
  const saved = process.env.STORE_KEY
  const prev = process.env.STORE_KEY_PREVIOUS
  process.env.STORE_KEY = newKey
  process.env.STORE_KEY_PREVIOUS = oldKey
  try {
    const loaded = await loadStore(path)
    assert.equal(loaded.users[0].email, 'a@b.c')
    await saveStore(path, loaded)
    const raw = await readFile(path, 'utf8')
    assert.match(raw, /^enc\.v2\./)
    delete process.env.STORE_KEY_PREVIOUS
    assert.equal((await loadStore(path)).users[0].email, 'a@b.c')
  } finally {
    if (saved === undefined) delete process.env.STORE_KEY
    else process.env.STORE_KEY = saved
    if (prev === undefined) delete process.env.STORE_KEY_PREVIOUS
    else process.env.STORE_KEY_PREVIOUS = prev
    await rm(dir, { recursive: true })
  }
})

test('tampered ciphertext is refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-bad-'))
  const path = join(dir, 'store.json')
  const saved = process.env.STORE_KEY
  process.env.STORE_KEY = 'ab'.repeat(32)
  try {
    await saveStore(path, { users: [], sessions: [], orders: [], waffo_products: {}, webhook_ids: [] })
    const raw = await readFile(path)
    raw[raw.length - 8] = raw[raw.length - 8] ^ 0xff
    await writeFile(path, raw)
    await assert.rejects(() => loadStore(path), /store_decrypt/)
  } finally {
    if (saved === undefined) delete process.env.STORE_KEY
    else process.env.STORE_KEY = saved
    await rm(dir, { recursive: true })
  }
})

test('site HMAC rejects a mutated body, an expired stamp, a replay, and a wrong key', () => {
  resetSiteNonces()
  const saved = process.env.RENTAL_SITE_KEY
  process.env.RENTAL_SITE_KEY = 'site-secret'
  try {
    const body = '{"id":"1"}'
    const headers = signSiteRequest({ method: 'POST', path: '/orders', body, key: 'site-secret' })
    const request = { method: 'POST', url: '/orders', headers }
    assert.equal(siteSignatureOk(request, body), true)
    assert.equal(siteSignatureOk(request, body), false)
    resetSiteNonces()
    assert.equal(siteSignatureOk(request, '{"id":"2"}'), false)
    resetSiteNonces()
    const old = signSiteRequest({
      method: 'POST',
      path: '/orders',
      body,
      key: 'site-secret',
      now: Date.now() - SIGN_WINDOW_MS - 1000,
    })
    assert.equal(siteSignatureOk({ method: 'POST', url: '/orders', headers: old }, body), false)
    resetSiteNonces()
    const other = signSiteRequest({ method: 'POST', path: '/orders', body, key: 'wrong' })
    assert.equal(siteSignatureOk({ method: 'POST', url: '/orders', headers: other }, body), false)
  } finally {
    if (saved === undefined) delete process.env.RENTAL_SITE_KEY
    else process.env.RENTAL_SITE_KEY = saved
    resetSiteNonces()
  }
})

test('the ninth order from one account is refused', () => {
  const id = 'user-limit-test'
  for (let i = 0; i < 8; i += 1) assert.equal(accountOrderOk(id), true)
  assert.equal(accountOrderOk(id), false)
})

test('audit logs never include emails, tokens, or glk_ keys', () => {
  const chunks = []
  const write = process.stdout.write
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(String(chunk))
    return write.call(process.stdout, chunk, ...rest)
  }
  try {
    audit('login', { email: 'user@made.local', token: 'sekrit', origin_key: 'glk_secret' })
    const line = chunks.join('')
    assert.equal(line.includes('user@made.local'), false)
    assert.equal(line.includes('sekrit'), false)
    assert.equal(line.includes('glk_'), false)
    assert.equal(JSON.parse(line).email, hashEmail('user@made.local'))
  } finally {
    process.stdout.write = write
  }
})
