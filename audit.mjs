import { createHash } from 'node:crypto'

const SECRET = /key|token|secret|password|authorization|cookie|glk_/iu

/**
 * @param value maybe an email
 * @returns 12-hex email hash, never the address
 */
export function hashEmail(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 12)
}

function scrub(value) {
  if (typeof value === 'string') {
    if (value.includes('glk_')) return '[redacted]'
    if (SECRET.test(value) && value.length > 8) return '[redacted]'
    return value
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      if (SECRET.test(key) || key === 'email') {
        out[key] = key === 'email' ? hashEmail(String(item ?? '')) : '[redacted]'
        continue
      }
      out[key] = scrub(item)
    }
    return out
  }
  return value
}

/**
 * One JSON line on stdout. Never writes tokens, keys, or emails in the clear.
 * @param event name
 * @param fields extra fields
 */
export function audit(event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...scrub(fields) })
  process.stdout.write(`${line}\n`)
}
