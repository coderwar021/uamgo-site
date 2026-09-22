import { createHash, randomBytes } from 'node:crypto'

/**
 * Paid Aether OAuth 2.1 issuer. Discovery is at /.well-known/openid-configuration.
 * @see https://mail.uamgo.com/docs
 * @returns origin without trailing slash
 */
export function aetherOrigin() {
  return (process.env.AETHER_ORIGIN ?? 'https://mail.uamgo.com').replace(/\/$/u, '')
}

/**
 * @returns OAuth client_id
 */
export function aetherClientId() {
  return (process.env.AETHER_CLIENT_ID ?? '').trim()
}

/**
 * @returns client_secret or empty for a public PKCE client
 */
export function aetherClientSecret() {
  return (process.env.AETHER_CLIENT_SECRET ?? '').trim()
}

/**
 * @returns whether an OAuth client is configured
 */
export function aetherReady() {
  return aetherClientId().length > 0
}

/**
 * Redirect URI registered on the Aether app.
 * @param fallback built from the incoming Host when env is empty
 * @returns absolute callback URL
 */
export function aetherRedirectUri(fallback) {
  const configured = (process.env.AETHER_REDIRECT_URI ?? '').trim()
  return configured.length > 0 ? configured : fallback
}

/**
 * @returns PKCE verifier, S256 challenge, state, nonce
 */
export function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return {
    verifier,
    challenge,
    state: randomBytes(16).toString('base64url'),
    nonce: randomBytes(16).toString('base64url'),
  }
}

/**
 * Authorization Code + PKCE URL.
 * @param redirectUri registered callback
 * @param pkce createPkce() result
 * @returns authorize URL
 */
export function authorizeUrl(redirectUri, pkce) {
  const url = new URL('/oauth/authorize', `${aetherOrigin()}/`)
  url.searchParams.set('client_id', aetherClientId())
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid profile email offline_access')
  url.searchParams.set('state', pkce.state)
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('nonce', pkce.nonce)
  return url.toString()
}

/**
 * Exchange the authorization code for tokens.
 * @param code query code
 * @param redirectUri same URI sent to authorize
 * @param verifier PKCE verifier
 * @returns token JSON
 */
export async function exchangeCode(code, redirectUri, verifier) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    client_id: aetherClientId(),
  })
  const secret = aetherClientSecret()
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (secret.length > 0) {
    headers.authorization = `Basic ${Buffer.from(`${aetherClientId()}:${secret}`).toString('base64')}`
  }
  const response = await fetch(`${aetherOrigin()}/oauth/token`, {
    method: 'POST',
    headers,
    body,
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

/**
 * @param accessToken bearer token
 * @returns userinfo JSON
 */
export async function fetchUserinfo(accessToken) {
  const response = await fetch(`${aetherOrigin()}/oauth/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  })
  const json = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, json }
}

/**
 * Email claim from UserInfo.
 * @param json userinfo body
 * @returns email or empty
 */
export function emailFromUserinfo(json) {
  const email = json?.email
  return typeof email === 'string' ? email.trim().toLowerCase() : ''
}

/**
 * @param json error body
 * @param fallback Chinese fallback
 * @returns message
 */
export function aetherMessage(json, fallback) {
  const error = json?.error_description ?? json?.error
  return typeof error === 'string' && error.length > 0 ? error : fallback
}
