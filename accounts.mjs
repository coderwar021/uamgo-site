import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import { sha256Hex } from './security.mjs'

const scryptAsync = promisify(scrypt)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
export const SESSION_AGE = 60 * 60 * 12

/**
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function loadStore(path) {
  try {
    const raw = await readFile(path)
    const parsed = JSON.parse(decodeStore(raw))
    return normalizeStore(parsed)
  } catch {
    return emptyStore()
  }
}

function emptyStore() {
  return { users: [], sessions: [], orders: [], waffo_products: {}, webhook_ids: [] }
}

function normalizeStore(parsed) {
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    waffo_products: parsed.waffo_products !== null
      && typeof parsed.waffo_products === 'object'
      && !Array.isArray(parsed.waffo_products)
      ? parsed.waffo_products
      : {},
    webhook_ids: Array.isArray(parsed.webhook_ids) ? parsed.webhook_ids.slice(-8_000) : [],
  }
}

/**
 * 32-byte AES key from STORE_KEY (64 hex chars) or STORE_KEY_BASE64.
 * @returns {Buffer | undefined}
 */
export function storeKey() {
  const hex = process.env.STORE_KEY ?? ''
  if (/^[0-9a-f]{64}$/iu.test(hex)) return Buffer.from(hex, 'hex')
  const b64 = process.env.STORE_KEY_BASE64 ?? ''
  if (b64.length > 0) {
    const buf = Buffer.from(b64, 'base64')
    if (buf.length === 32) return buf
  }
  return undefined
}

/**
 * Production must encrypt the account file. Tests leave STORE_KEY unset.
 */
export function assertProductionStoreKey() {
  if (process.env.NODE_ENV === 'production' && storeKey() === undefined) {
    throw new Error('STORE_KEY required in production')
  }
}

function decodeStore(raw) {
  const text = raw.toString('utf8')
  if (!text.startsWith('enc.v1.')) return text
  const key = storeKey()
  if (key === undefined) throw new Error('STORE_KEY required to read encrypted store')
  const blob = Buffer.from(text.slice('enc.v1.'.length), 'base64')
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const data = blob.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

function encodeStore(json) {
  const key = storeKey()
  if (key === undefined) return json
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc.v1.${Buffer.concat([iv, tag, encrypted]).toString('base64')}\n`
}

/**
 * @param {string} path
 * @param {object} data
 */
export async function saveStore(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const body = encodeStore(`${JSON.stringify(data, null, 2)}\n`)
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, body, { mode: 0o600 })
  await rename(tmp, path)
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * @param {unknown} email
 * @param {unknown} password
 * @returns {string | undefined} error code
 */
export function validateCredentials(email, password) {
  const address = normalizeEmail(email)
  const secret = String(password ?? '')
  if (!EMAIL.test(address)) return 'email'
  if (secret.length < 8 || secret.length > 200) return 'password'
  return undefined
}

/**
 * @param {string} password
 * @returns {Promise<{ salt: string, hash: string }>}
 */
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 32)
  return { salt: salt.toString('hex'), hash: hash.toString('hex') }
}

/**
 * @param {string} password
 * @param {{ salt: string, hash: string }} stored
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
  const salt = Buffer.from(stored.salt, 'hex')
  const expected = Buffer.from(stored.hash, 'hex')
  const actual = await scryptAsync(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * @param {object} store
 * @param {string} email
 * @param {string} password
 */
export async function registerUser(store, email, password) {
  const address = normalizeEmail(email)
  if (store.users.some((user) => user.email === address)) return { error: 'exists' }
  const secret = await hashPassword(password)
  const user = { id: randomUUID(), email: address, salt: secret.salt, hash: secret.hash }
  store.users.push(user)
  return issueSession(store, user)
}

/**
 * @param {object} store
 * @param {string} email
 * @param {string} password
 */
export async function loginUser(store, email, password) {
  const address = normalizeEmail(email)
  const user = store.users.find((row) => row.email === address)
  if (user === undefined || !(await verifyPassword(password, user))) return { error: 'credentials' }
  return issueSession(store, user)
}

function issueSession(store, user) {
  purgeExpired(store)
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(32).toString('base64url')
  const now = Date.now()
  store.sessions.push({
    token_hash: sha256Hex(token),
    csrf_hash: sha256Hex(csrf),
    user_id: user.id,
    created_at: now,
    expires_at: now + SESSION_AGE * 1000,
  })
  return { token, csrf, email: user.email }
}

function purgeExpired(store) {
  const now = Date.now()
  store.sessions = store.sessions.filter((row) => {
    if (typeof row.expires_at === 'number') return row.expires_at > now
    return true
  })
}

/**
 * After Aether OAuth UserInfo, open a local session. Cookie value is not stored.
 * @param {object} store
 * @param {string} email
 */
export function sessionForEmail(store, email) {
  const address = normalizeEmail(email)
  let user = store.users.find((row) => row.email === address)
  if (user === undefined) {
    user = { id: randomUUID(), email: address, aether: true }
    store.users.push(user)
  }
  return issueSession(store, user)
}

/**
 * @param {object} store
 * @param {string} token
 */
export function userForToken(store, token) {
  if (token.length === 0) return undefined
  purgeExpired(store)
  const digest = sha256Hex(token)
  const session = store.sessions.find((row) => row.token_hash === digest)
  if (session === undefined) return undefined
  return store.users.find((user) => user.id === session.user_id)
}

/**
 * @param {object} store
 * @param {string} token
 * @param {string} csrf
 */
export function csrfOk(store, token, csrf) {
  if (token.length === 0 || csrf.length === 0) return false
  const digest = sha256Hex(token)
  const session = store.sessions.find((row) => row.token_hash === digest)
  if (session === undefined || typeof session.csrf_hash !== 'string') return false
  return timingSafeEqual(Buffer.from(session.csrf_hash, 'hex'), Buffer.from(sha256Hex(csrf), 'hex'))
}

/**
 * @param {string} cookieHeader
 * @param {string} name
 * @returns {string}
 */
export function cookieValue(cookieHeader, name) {
  for (const part of String(cookieHeader ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return ''
}

/**
 * @param {string} cookieHeader
 * @returns {string}
 */
export function sessionFromCookie(cookieHeader) {
  return cookieValue(cookieHeader, '__Host-session') || cookieValue(cookieHeader, 'session')
}

/**
 * @param {string} cookieHeader
 * @returns {string}
 */
export function csrfFromCookie(cookieHeader) {
  return cookieValue(cookieHeader, '__Host-csrf') || cookieValue(cookieHeader, 'csrf')
}

/**
 * @param {string} name base name without prefix
 * @param {string} token value
 * @param {boolean} secure HTTPS
 * @param {number} maxAge seconds
 * @param {{ httpOnly?: boolean, sameSite?: string }} options cookie flags
 */
export function namedCookie(name, token, secure, maxAge, options = {}) {
  const httpOnly = options.httpOnly !== false
  const sameSite = options.sameSite ?? 'Strict'
  const cookieName = secure ? `__Host-${name}` : name
  const pieces = [
    `${cookieName}=${token}`,
    'Path=/',
    `SameSite=${sameSite}`,
    `Max-Age=${String(maxAge)}`,
  ]
  if (httpOnly) pieces.push('HttpOnly')
  if (secure) pieces.push('Secure')
  return pieces.join('; ')
}

/**
 * @param {boolean} secure
 * @param {string} token
 * @param {number} maxAge
 */
export function sessionCookie(secure, token, maxAge) {
  return namedCookie('session', token, secure, maxAge, { httpOnly: true, sameSite: 'Strict' })
}

/**
 * Readable by JS for the double-submit CSRF header. XSS is blocked by CSP.
 * @param {boolean} secure
 * @param {string} token
 * @param {number} maxAge
 */
export function csrfCookie(secure, token, maxAge) {
  return namedCookie('csrf', token, secure, maxAge, { httpOnly: false, sameSite: 'Strict' })
}
