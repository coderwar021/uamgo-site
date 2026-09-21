import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/**
 * @param {string} path
 * @returns {Promise<{ users: object[], sessions: object[], orders: object[] }>}
 */
export async function loadStore(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    }
  } catch {
    return { users: [], sessions: [], orders: [] }
  }
}

/**
 * @param {string} path
 * @param {object} data
 */
export async function saveStore(path, data) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`)
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
  const token = randomBytes(24).toString('hex')
  store.users.push(user)
  store.sessions.push({ token, user_id: user.id })
  return { token, email: address }
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
  const token = randomBytes(24).toString('hex')
  store.sessions.push({ token, user_id: user.id })
  return { token, email: address }
}

/**
 * @param {object} store
 * @param {string} token
 */
export function userForToken(store, token) {
  if (token.length === 0) return undefined
  const session = store.sessions.find((row) => row.token === token)
  if (session === undefined) return undefined
  return store.users.find((user) => user.id === session.user_id)
}

/**
 * @param {string} cookieHeader
 * @returns {string}
 */
export function sessionFromCookie(cookieHeader) {
  for (const part of String(cookieHeader ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'session') return rest.join('=')
  }
  return ''
}

/**
 * @param {boolean} secure
 * @param {string} token
 * @param {number} maxAge
 */
export function sessionCookie(secure, token, maxAge) {
  const pieces = [
    `session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${String(maxAge)}`,
  ]
  if (secure) pieces.push('Secure')
  return pieces.join('; ')
}
