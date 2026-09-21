/**
 * First-party Aether mailbox at mail.uamgo.com: OTP + password.
 * @see https://mail.uamgo.com/docs
 * @returns origin without trailing slash
 */
export function aetherOrigin() {
  return (process.env.AETHER_ORIGIN ?? 'https://mail.uamgo.com').replace(/\/$/u, '')
}

/**
 * POST JSON to Aether auth routes.
 * @param path /api/auth/...
 * @param body JSON body
 * @returns status and parsed JSON
 */
export async function aetherPost(path, body) {
  let response
  try {
    response = await fetch(`${aetherOrigin()}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, status: 503, json: { error: '邮箱服务暂时连不上，请稍后重试。' } }
  }
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

/**
 * Ask Aether to email a 6-digit code.
 * @param email address
 * @param purpose login | register | reset
 */
export async function sendAetherOtp(email, purpose) {
  return aetherPost('/api/auth/send-otp', { email, purpose })
}

/**
 * Register on Aether (email code required).
 * @param fields register fields
 */
export async function registerAether(fields) {
  return aetherPost('/api/auth/register', fields)
}

/**
 * Sign in on Aether (email code required).
 * @param fields login fields
 */
export async function loginAether(fields) {
  return aetherPost('/api/auth/login', fields)
}

/**
 * Human-readable Aether error, or a fallback.
 * @param json response body
 * @param fallback Chinese fallback
 * @returns message
 */
export function aetherMessage(json, fallback) {
  const error = json?.error
  return typeof error === 'string' && error.length > 0 ? error : fallback
}
