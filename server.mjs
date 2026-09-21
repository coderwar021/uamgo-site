import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStore,
  loginUser,
  registerUser,
  saveStore,
  sessionCookie,
  sessionFromCookie,
  userForToken,
  validateCredentials,
} from './accounts.mjs'

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)))
const PORT = Number(process.env.PORT ?? 3000)
const DB = process.env.DATABASE_PATH ?? resolve(fileURLToPath(new URL('./data/store.json', import.meta.url)))
const SESSION_AGE = 60 * 60 * 24 * 30

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain; charset=utf-8'],
])

/**
 * Resolve a request path to a file inside the served root.
 * @param url - request target, which may carry a query string.
 * @returns the absolute path, or undefined when it escapes the root.
 */
function resolveTarget(url) {
  const path = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  const relative = normalize(path).replace(/^([/\\])+/u, '')
  const target = resolve(ROOT, relative)
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return undefined
  return target
}

const INSTALLER_PATH = '/install.sh'
const INSTALLER_ASSET
  = 'https://github.com/coderwar021/uamgo-site/releases/latest/download/install.sh'

/** Accept `/terms` for `terms.html` and a directory for its index. */
async function fileFor(target) {
  for (const candidate of [target, `${target}.html`, join(target, 'index.html')]) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return { path: candidate, size: info.size }
    } catch {
      continue
    }
  }
  return undefined
}

function isSecure(request) {
  return request.headers['x-forwarded-proto'] === 'https'
}

function sendJson(response, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  })
  response.end(payload)
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  return JSON.parse(raw)
}

function cookieHeaders(request, token, clear = false) {
  return {
    'set-cookie': sessionCookie(isSecure(request), clear ? '' : token, clear ? 0 : SESSION_AGE),
  }
}

const PLANS = [
  { id: 'group5', name: 'Qwen3.6-27B 4-bit', price_cny_per_hour: 50 },
  { id: 'group6', name: 'Gemma 4 E2B IT', price_cny_per_hour: 25 },
]

function publicOrder(order) {
  return {
    order_id: order.id,
    plan_id: order.plan_id,
    hours: order.hours,
    status: order.status,
    checkout: order.checkout,
    base_url: order.base_url,
    key: order.key,
    model: order.model,
  }
}

/**
 * Account and GPU-order JSON routes. Static files stay on GET below.
 * @param request incoming HTTP request
 * @param response outgoing HTTP response
 * @returns whether this request was an API route
 */
async function handleApi(request, response) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const method = request.method ?? 'GET'

  if (method === 'GET' && url.pathname === '/auth/me') {
    const store = await loadStore(DB)
    const user = userForToken(store, sessionFromCookie(request.headers.cookie))
    sendJson(response, 200, { email: user?.email ?? null })
    return true
  }

  if (method === 'POST' && (url.pathname === '/auth/register' || url.pathname === '/auth/login')) {
    let body
    try {
      body = await readJson(request)
    } catch {
      sendJson(response, 400, { error: 'json' })
      return true
    }
    const invalid = validateCredentials(body.email, body.password)
    if (invalid === 'email') {
      sendJson(response, 400, { error: 'email', message: '请填写有效邮箱。' })
      return true
    }
    if (invalid === 'password') {
      sendJson(response, 400, { error: 'password', message: '密码至少 8 位。' })
      return true
    }
    const store = await loadStore(DB)
    const result = url.pathname === '/auth/register'
      ? await registerUser(store, body.email, body.password)
      : await loginUser(store, body.email, body.password)
    if (result.error === 'exists') {
      sendJson(response, 409, { error: 'exists', message: '这个邮箱已经注册，请直接登录。' })
      return true
    }
    if (result.error === 'credentials') {
      sendJson(response, 401, { error: 'credentials', message: '邮箱或密码不对。' })
      return true
    }
    await saveStore(DB, store)
    sendJson(
      response,
      url.pathname === '/auth/register' ? 201 : 200,
      { email: result.email },
      cookieHeaders(request, result.token),
    )
    return true
  }

  if (method === 'POST' && url.pathname === '/auth/logout') {
    const store = await loadStore(DB)
    const token = sessionFromCookie(request.headers.cookie)
    store.sessions = store.sessions.filter((row) => row.token !== token)
    await saveStore(DB, store)
    sendJson(response, 200, { email: null }, cookieHeaders(request, '', true))
    return true
  }

  if (method === 'GET' && url.pathname === '/plans') {
    sendJson(response, 200, PLANS)
    return true
  }

  if (method === 'POST' && url.pathname === '/orders') {
    const store = await loadStore(DB)
    const user = userForToken(store, sessionFromCookie(request.headers.cookie))
    if (user === undefined) {
      sendJson(response, 401, { error: 'auth', message: '请先点右上角登录。' })
      return true
    }
    let body
    try {
      body = await readJson(request)
    } catch {
      sendJson(response, 400, { error: 'json' })
      return true
    }
    const hours = Number(body.hours)
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
      sendJson(response, 400, { error: 'hours', message: '小时数须为 1 到 168。' })
      return true
    }
    const plan = PLANS.find((row) => row.id === body.plan_id)
    if (plan === undefined) {
      sendJson(response, 400, { error: 'plan', message: '未知套餐。' })
      return true
    }
    const id = randomUUID()
    const order = {
      id,
      user_id: user.id,
      plan_id: plan.id,
      hours,
      status: 'pending_payment',
      checkout: `https://pancake.waffo.ai/checkout?order=${id}`,
    }
    store.orders.push(order)
    await saveStore(DB, store)
    sendJson(response, 201, publicOrder(order))
    return true
  }

  if (method === 'GET' && url.pathname.startsWith('/orders/')) {
    const store = await loadStore(DB)
    const user = userForToken(store, sessionFromCookie(request.headers.cookie))
    if (user === undefined) {
      sendJson(response, 401, { error: 'auth' })
      return true
    }
    const id = url.pathname.slice('/orders/'.length)
    const order = store.orders.find((row) => row.id === id && row.user_id === user.id)
    if (order === undefined) {
      sendJson(response, 404, { error: 'order' })
      return true
    }
    sendJson(response, 200, publicOrder(order))
    return true
  }

  return false
}

const server = createServer((request, response) => {
  void (async () => {
    const handled = await handleApi(request, response)
    if (handled) return

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD, POST' }).end('Method Not Allowed')
      return
    }
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    if (requested === INSTALLER_PATH) {
      response.writeHead(302, { location: INSTALLER_ASSET, 'cache-control': 'no-cache' }).end()
      return
    }
    const target = resolveTarget(request.url ?? '/')
    const found = target === undefined ? undefined : await fileFor(target)
    if (found === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found')
      return
    }
    const type = TYPES.get(extname(found.path)) ?? 'application/octet-stream'
    response.writeHead(200, { 'content-type': type, 'content-length': found.size })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(found.path).pipe(response)
  })().catch((error) => {
    if (!response.headersSent) sendJson(response, 500, { error: String(error) })
  })
})

const startedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (startedDirectly) {
  server.listen(PORT, () => {
    process.stdout.write(`madecoding.com listening on :${PORT}\n`)
  })
}

export { server, handleApi }
