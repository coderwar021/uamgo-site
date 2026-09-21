import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadStore,
  saveStore,
  sessionCookie,
  sessionForEmail,
  sessionFromCookie,
  userForToken,
  validateCredentials,
} from './accounts.mjs'
import {
  aetherMessage,
  loginAether,
  registerAether,
  sendAetherOtp,
} from './aether.mjs'
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

/**
 * @param request incoming HTTP request
 * @returns raw body
 */
async function readRaw(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
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

  if (method === 'POST' && url.pathname === '/webhooks/waffo') {
    const raw = await readRaw(request)
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
      if (order !== undefined && event.eventType === 'order.completed') {
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

  if (method === 'POST' && url.pathname === '/auth/otp') {
    let body
    try {
      body = await readJson(request)
    } catch {
      sendJson(response, 400, { error: 'json' })
      return true
    }
    const email = String(body.email ?? '')
    const purpose = body.purpose === 'register' ? 'register' : 'login'
    if (validateCredentials(email, 'long-enough') === 'email') {
      sendJson(response, 400, { error: 'email', message: '请填写有效邮箱。' })
      return true
    }
    const result = await sendAetherOtp(email, purpose)
    if (!result.ok) {
      sendJson(response, result.status === 503 ? 503 : 400, {
        error: 'otp',
        message: aetherMessage(result.json, '验证码发送失败。'),
      })
      return true
    }
    const hint = result.json?.devCode
    sendJson(response, 200, {
      ok: true,
      message: typeof hint === 'string' && hint.length > 0
        ? `开发模式验证码：${hint}`
        : '验证码已发到邮箱（Aether / mail.uamgo.com）。',
    })
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
    const code = String(body.code ?? '').trim()
    if (!/^\d{6}$/u.test(code)) {
      sendJson(response, 400, { error: 'code', message: '请填写 6 位邮箱验证码。' })
      return true
    }
    const aether = url.pathname === '/auth/register'
      ? await registerAether({
        email: body.email,
        password: body.password,
        confirmPassword: body.confirmPassword ?? body.password,
        name: String(body.name ?? '').trim() || String(body.email).split('@')[0],
        code,
      })
      : await loginAether({
        email: body.email,
        password: body.password,
        code,
      })
    if (!aether.ok) {
      sendJson(response, aether.status >= 400 && aether.status < 500 ? aether.status : 401, {
        error: 'aether',
        message: aetherMessage(aether.json, '登录失败。'),
      })
      return true
    }
    const store = await loadStore(DB)
    const result = sessionForEmail(store, body.email)
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
    if (!paymentsReady()) {
      sendJson(response, 503, {
        error: 'payments_unconfigured',
        message: '支付未开通：在 Railway 配置 WAFFO_PRIVATE_KEY（控制台 API 密钥下载的整段 RSA 私钥）。Merchant ID 和 Store ID 已写进代码。也可改用 WAFFO_PRIVATE_KEY_BASE64。',
      })
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
    }
    let productId
    try {
      productId = await productIdForPlan(store, plan)
    } catch (error) {
      sendJson(response, 503, {
        error: 'product',
        message: error instanceof Error ? `创建商品失败：${error.message}` : '创建商品失败',
      })
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
    } catch (error) {
      waffoError = error instanceof Error ? error.message : 'checkout'
    }
    if (checkout === undefined) {
      sendJson(response, 503, {
        error: 'checkout',
        message: waffoError === undefined
          ? '支付接口没有返回收银台地址。核对 Merchant ID、私钥是否对应同一把 key，以及商品 ID 是否为 PROD_。'
          : `支付接口拒绝：${waffoError}`,
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
