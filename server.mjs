import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertProductionStoreKey,
  cookieValue,
  csrfCookie,
  csrfFromCookie,
  csrfOk,
  loadStore,
  namedCookie,
  saveStore,
  sessionCookie,
  sessionForEmail,
  sessionFromCookie,
  SESSION_AGE,
  userForToken,
} from './accounts.mjs'
import {
  aetherMessage,
  aetherReady,
  aetherRedirectUri,
  authorizeUrl,
  createPkce,
  emailFromUserinfo,
  exchangeCode,
  fetchUserinfo,
} from './aether.mjs'
import {
  checkoutAllowed,
  isUuid,
  lockResponse,
  originAllowed,
  rateOk,
  readLimited,
  safeEqual,
  sha256Hex,
} from './security.mjs'
import {
  createWaffoCheckout,
  ensureHttpWebhook,
  ensureOnetimeProduct,
  paymentsReady,
  productIdFromEnv,
  verifyWaffoWebhook,
} from './waffo.mjs'

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)))
const PORT = Number(process.env.PORT ?? 3000)
const DB = process.env.DATABASE_PATH ?? resolve(fileURLToPath(new URL('./data/store.json', import.meta.url)))

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

function pkceName(request, name) {
  return cookieValue(request.headers.cookie, `__Host-${name}`)
    || cookieValue(request.headers.cookie, name)
}

function pkceSetCookies(request, pkce) {
  const secure = isSecure(request)
  return [
    namedCookie('aether_state', pkce.state, secure, 600, { httpOnly: true, sameSite: 'Lax' }),
    namedCookie('aether_verifier', pkce.verifier, secure, 600, { httpOnly: true, sameSite: 'Lax' }),
  ]
}

function pkceClearCookies(request) {
  const secure = isSecure(request)
  return [
    namedCookie('aether_state', '', secure, 0, { httpOnly: true, sameSite: 'Lax' }),
    namedCookie('aether_verifier', '', secure, 0, { httpOnly: true, sameSite: 'Lax' }),
  ]
}

function sessionCookies(request, token, csrf) {
  const secure = isSecure(request)
  return [
    sessionCookie(secure, token, SESSION_AGE),
    csrfCookie(secure, csrf, SESSION_AGE),
  ]
}

function clearSessionCookies(request) {
  const secure = isSecure(request)
  return [
    sessionCookie(secure, '', 0),
    csrfCookie(secure, '', 0),
  ]
}

function requireCsrf(request, store) {
  const token = sessionFromCookie(request.headers.cookie)
  const csrf = request.headers['x-csrf-token']
  const header = typeof csrf === 'string' ? csrf : csrfFromCookie(request.headers.cookie)
  return originAllowed(request) && csrfOk(store, token, header)
}

function tooMany(response) {
  sendJson(response, 429, { error: 'rate' }, { 'retry-after': '60' })
}

async function readJson(request) {
  const raw = await readLimited(request)
  if (raw.length === 0) return {}
  return JSON.parse(raw)
}

/**
 * Env product id, else cached PROD_ from a previous SDK create.
 * @param store local account store
 * @param plan catalog row
 * @returns PROD_ id
 */
async function productIdForPlan(store, plan) {
  const fromEnv = productIdFromEnv(plan.id)
  if (fromEnv.length > 0) return fromEnv
  const cached = store.waffo_products[plan.id]
  if (typeof cached === 'string' && cached.startsWith('PROD_')) return cached
  const created = await ensureOnetimeProduct(plan)
  store.waffo_products[plan.id] = created
  return created
}

const PLANS = [
  { id: 'group5', name: 'Qwen3.6-27B 4-bit', price_cny_per_hour: 50 },
  { id: 'group6', name: 'Gemma 4 E2B IT', price_cny_per_hour: 25 },
]

function publicOrder(order) {
  const checkout = checkoutAllowed(order.checkout) ? order.checkout : undefined
  return {
    order_id: order.id,
    plan_id: order.plan_id,
    hours: order.hours,
    status: order.status,
    checkout,
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

  if (method === 'POST' && url.pathname === '/webhooks/waffo') {
    if (!rateOk(request, 'webhook')) {
      tooMany(response)
      return true
    }
    let raw
    try {
      raw = await readLimited(request)
    } catch (error) {
      if (error.code === 'payload_too_large') {
        sendJson(response, 413, { error: 'payload' })
        return true
      }
      throw error
    }
    const signature = request.headers['x-waffo-signature']
    let event
    try {
      event = verifyWaffoWebhook(raw, typeof signature === 'string' ? signature : undefined)
    } catch {
      sendJson(response, 401, { error: 'signature' })
      return true
    }
    const store = await loadStore(DB)
    if (!store.webhook_ids.includes(event.id)) {
      store.webhook_ids.push(event.id)
      const external = event.data?.orderMerchantExternalId
      const metaId = event.data?.orderMetadata?.order_id
      const order = store.orders.find((row) => row.id === external || row.id === metaId)
      if (order !== undefined && event.eventType === 'order.completed' && order.status === 'pending_payment') {
        order.status = 'paid'
        order.waffo_order_id = event.data?.orderId
      }
      await saveStore(DB, store)
    }
    sendJson(response, 200, { ok: true })
    return true
  }

  if (method === 'GET' && url.pathname === '/auth/me') {
    const store = await loadStore(DB)
    const user = userForToken(store, sessionFromCookie(request.headers.cookie))
    sendJson(response, 200, { email: user?.email ?? null })
    return true
  }

  if (method === 'GET' && url.pathname === '/auth/aether') {
    if (!rateOk(request, 'auth')) {
      tooMany(response)
      return true
    }
    if (!aetherReady()) {
      sendJson(response, 503, {
        error: 'aether_unconfigured',
        message: '登录未开通：在 Railway 配置 AETHER_CLIENT_ID。回调地址填 https://madecoding.com/auth/callback。',
      })
      return true
    }
    const redirectUri = aetherRedirectUri()
    const pkce = createPkce()
    response.writeHead(302, {
      location: authorizeUrl(redirectUri, pkce),
      'cache-control': 'no-store',
      'set-cookie': pkceSetCookies(request, pkce),
    })
    response.end()
    return true
  }

  if (method === 'GET' && url.pathname === '/auth/callback') {
    if (!rateOk(request, 'auth')) {
      tooMany(response)
      return true
    }
    const error = url.searchParams.get('error')
    if (typeof error === 'string' && error.length > 0) {
      sendJson(response, 401, {
        error,
        message: aetherMessage(
          { error, error_description: url.searchParams.get('error_description') },
          'Aether 拒绝了授权。',
        ),
      })
      return true
    }
    const code = url.searchParams.get('code') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const expected = pkceName(request, 'aether_state')
    const verifier = pkceName(request, 'aether_verifier')
    if (code.length === 0 || state.length === 0 || expected.length === 0 || !safeEqual(state, expected) || verifier.length === 0) {
      sendJson(response, 400, { error: 'state', message: 'OAuth 回调无效，请重新登录。' })
      return true
    }
    const redirectUri = aetherRedirectUri()
    let tokens
    try {
      tokens = await exchangeCode(code, redirectUri, verifier)
    } catch {
      sendJson(response, 503, { error: 'token', message: '换 token 失败。' })
      return true
    }
    const access = tokens.json?.access_token
    if (!tokens.ok || typeof access !== 'string') {
      sendJson(response, 401, {
        error: 'token',
        message: aetherMessage(tokens.json, 'Aether 没有返回 access_token。'),
      })
      return true
    }
    let profile
    try {
      profile = await fetchUserinfo(access)
    } catch {
      sendJson(response, 503, { error: 'userinfo', message: '读取 UserInfo 失败。' })
      return true
    }
    const email = emailFromUserinfo(profile.json)
    if (!profile.ok || email.length === 0) {
      sendJson(response, 401, {
        error: 'userinfo',
        message: aetherMessage(profile.json, 'Aether 没有返回邮箱。'),
      })
      return true
    }
    const store = await loadStore(DB)
    const result = sessionForEmail(store, email)
    await saveStore(DB, store)
    response.writeHead(302, {
      location: '/',
      'cache-control': 'no-store',
      'set-cookie': [
        ...sessionCookies(request, result.token, result.csrf),
        ...pkceClearCookies(request),
      ],
    })
    response.end()
    return true
  }

  if (method === 'POST' && url.pathname === '/auth/logout') {
    if (!rateOk(request, 'auth')) {
      tooMany(response)
      return true
    }
    const store = await loadStore(DB)
    if (!requireCsrf(request, store)) {
      sendJson(response, 403, { error: 'csrf' })
      return true
    }
    const token = sessionFromCookie(request.headers.cookie)
    const digest = sha256Hex(token)
    store.sessions = store.sessions.filter((row) => row.token_hash !== digest)
    await saveStore(DB, store)
    sendJson(response, 200, { email: null }, { 'set-cookie': clearSessionCookies(request) })
    return true
  }

  if (method === 'GET' && url.pathname === '/plans') {
    sendJson(response, 200, PLANS)
    return true
  }

  if (method === 'POST' && url.pathname === '/orders') {
    if (!rateOk(request, 'order')) {
      tooMany(response)
      return true
    }
    const store = await loadStore(DB)
    if (!requireCsrf(request, store)) {
      sendJson(response, 403, { error: 'csrf' })
      return true
    }
    const user = userForToken(store, sessionFromCookie(request.headers.cookie))
    if (user === undefined) {
      sendJson(response, 401, { error: 'auth', message: '请先点右上角登录。' })
      return true
    }
    if (!paymentsReady()) {
      sendJson(response, 503, {
        error: 'payments_unconfigured',
        message: '支付未开通：配置 WAFFO_PRIVATE_KEY。',
      })
      return true
    }
    let body
    try {
      body = await readJson(request)
    } catch (error) {
      if (error.code === 'payload_too_large') {
        sendJson(response, 413, { error: 'payload' })
        return true
      }
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
    }
    let productId
    try {
      productId = await productIdForPlan(store, plan)
    } catch {
      sendJson(response, 503, { error: 'product', message: '创建商品失败。' })
      return true
    }
    let checkout
    let waffoError
    try {
      const created = await createWaffoCheckout(
        order,
        user.email,
        plan.price_cny_per_hour,
        productId,
      )
      checkout = created.checkout
      waffoError = created.error
    } catch {
      waffoError = 'checkout'
    }
    if (!checkoutAllowed(checkout)) {
      sendJson(response, 503, {
        error: 'checkout',
        message: waffoError === undefined ? '支付接口没有返回合法收银台地址。' : `支付接口拒绝：${waffoError}`,
      })
      return true
    }
    order.checkout = checkout
    store.orders.push(order)
    await saveStore(DB, store)
    void ensureHttpWebhook().catch(() => undefined)
    sendJson(response, 201, publicOrder(order))
    return true
  }

  if (method === 'GET' && url.pathname.startsWith('/orders/')) {
    const id = url.pathname.slice('/orders/'.length)
    if (!isUuid(id)) {
      sendJson(response, 404, { error: 'order' })
      return true
    }
    const store = await loadStore(DB)
    const user = userForToken(store, sessionFromCookie(request.headers.cookie))
    if (user === undefined) {
      sendJson(response, 401, { error: 'auth' })
      return true
    }
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
  lockResponse(response)
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
    if (error?.code === 'payload_too_large') {
      sendJson(response, 413, { error: 'payload' })
      return
    }
    if (!response.headersSent) sendJson(response, 500, { error: 'internal' })
  })
})

const startedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (startedDirectly) {
  assertProductionStoreKey()
  server.listen(PORT, () => {
    process.stdout.write(`madecoding.com listening on :${PORT}\n`)
  })
}

export { server, handleApi, assertProductionStoreKey }
