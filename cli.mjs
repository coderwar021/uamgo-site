import { randomBytes } from 'node:crypto'
import { sha256Hex } from './security.mjs'

export const GRANT_AGE_MS = 10 * 60 * 1000
export const POLL_INTERVAL_SEC = 2
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * @param {object} store
 */
export function purgeCliGrants(store) {
  const now = Date.now()
  store.cli_grants = (store.cli_grants ?? []).filter((row) => row.expires_at > now)
}

/**
 * @returns {string} displayed as XXXX-XXXX
 */
export function newUserCode() {
  let raw = ''
  const bytes = randomBytes(8)
  for (const byte of bytes) raw += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/**
 * @param {object} store
 * @returns {{ device_code: string, user_code: string, expires_in: number, interval: number }}
 */
export function startGrant(store) {
  purgeCliGrants(store)
  const device_code = randomBytes(32).toString('base64url')
  const user_code = newUserCode()
  const now = Date.now()
  store.cli_grants.push({
    device_hash: sha256Hex(device_code),
    user_hash: sha256Hex(user_code),
    created_at: now,
    expires_at: now + GRANT_AGE_MS,
  })
  return {
    device_code,
    user_code,
    expires_in: Math.floor(GRANT_AGE_MS / 1000),
    interval: POLL_INTERVAL_SEC,
  }
}

/**
 * @param {unknown} value
 * @returns {string | undefined} error code
 */
export function validateApiKey(value) {
  const key = String(value ?? '').trim()
  if (!/^sk-[A-Za-z0-9_-]{10,}$/u.test(key)) return 'key'
  return undefined
}

/**
 * @param {object} store
 * @param {string} userCode
 * @param {string} apiKey
 * @param {string} userId
 * @returns {{ error?: string }}
 */
export function approveGrant(store, userCode, apiKey, userId) {
  purgeCliGrants(store)
  const digest = sha256Hex(String(userCode ?? '').trim().toUpperCase())
  const grant = (store.cli_grants ?? []).find((row) => row.user_hash === digest)
  if (grant === undefined) return { error: 'code' }
  const invalid = validateApiKey(apiKey)
  if (invalid !== undefined) return { error: invalid }
  grant.api_key = String(apiKey).trim()
  grant.user_id = userId
  grant.approved_at = Date.now()
  const user = store.users.find((row) => row.id === userId)
  if (user !== undefined) user.madeapi_key = grant.api_key
  return {}
}

/**
 * @param {object} store
 * @param {string} deviceCode
 * @returns {{ error?: string, api_key?: string }}
 */
export function pollGrant(store, deviceCode) {
  purgeCliGrants(store)
  const digest = sha256Hex(String(deviceCode ?? ''))
  const grants = store.cli_grants ?? []
  const index = grants.findIndex((row) => row.device_hash === digest)
  if (index < 0) return { error: 'expired' }
  const grant = grants[index]
  if (typeof grant.api_key !== 'string' || grant.api_key.length === 0) return { error: 'pending' }
  const api_key = grant.api_key
  grants.splice(index, 1)
  return { api_key }
}

/**
 * @param {object} user
 * @returns {boolean}
 */
export function userHasKey(user) {
  return typeof user?.madeapi_key === 'string' && user.madeapi_key.length > 0
}
