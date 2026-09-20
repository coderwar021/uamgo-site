import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)))
const PORT = Number(process.env.PORT ?? 3000)

// Release binaries are too large to keep in the repository and the filesystem
// here does not survive a redeploy, so the site streams them from the private
// release repository. Readers of uamgo.com never see that indirection, and the
// token never leaves this process.
const RELEASE_REPO = process.env.UAMGO_RELEASE_REPO ?? 'coderwar021/uamgo'
const RELEASE_TOKEN = process.env.UAMGO_RELEASE_TOKEN ?? process.env.GITHUB_TOKEN
const RELEASE_TTL_MS = 60_000

/** Asset names the installer asks for: the channel pointer and the binaries. */
const CHANNEL_NAMES = new Set(['stable', 'alpha'])
const BINARY_NAME = /^uamgo-\d+\.\d+\.\d+(?:-[A-Za-z0-9._]+)?-(?:macos|linux|windows)-(?:x86_64|aarch64)(?:\.exe)?$/u

let releaseCache = { at: 0, release: undefined }

async function githubJson(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'uamgo-site',
      ...RELEASE_TOKEN === undefined ? {} : { authorization: `Bearer ${RELEASE_TOKEN}` },
    },
  })
  if (!response.ok) throw new Error(`GitHub ${path} responded ${response.status}`)
  return response.json()
}

/** The newest published release, memoized so a burst of installs costs one call. */
async function latestRelease() {
  if (releaseCache.release !== undefined && Date.now() - releaseCache.at < RELEASE_TTL_MS) {
    return releaseCache.release
  }
  const release = await githubJson(`/repos/${RELEASE_REPO}/releases/latest`)
  releaseCache = { at: Date.now(), release }
  return release
}

async function serveChannel(response) {
  const release = await latestRelease()
  const version = String(release.tag_name ?? '').replace(/^v/u, '')
  if (version === '') throw new Error('the latest release has no version tag')
  const body = `${version}\n`
  response.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'public, max-age=60',
  })
  response.end(body)
}

async function serveBinary(name, response, headOnly) {
  const release = await latestRelease()
  const asset = (release.assets ?? []).find((candidate) => candidate.name === name)
  if (asset === undefined) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found')
    return
  }
  // The octet-stream accept header is what makes the API return the bytes
  // rather than the asset's JSON description.
  const upstream = await fetch(asset.url, {
    headers: {
      accept: 'application/octet-stream',
      'user-agent': 'uamgo-site',
      ...RELEASE_TOKEN === undefined ? {} : { authorization: `Bearer ${RELEASE_TOKEN}` },
    },
    redirect: 'follow',
  })
  if (!upstream.ok || upstream.body === null) throw new Error(`asset ${name} responded ${upstream.status}`)
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(asset.size),
    'content-disposition': `attachment; filename="${name}"`,
  })
  if (headOnly) {
    response.end()
    void upstream.body.cancel()
    return
  }
  const { Readable } = await import('node:stream')
  Readable.fromWeb(upstream.body).pipe(response)
}

// The installer and the channel pointer are fetched by shell scripts, so they
// are served as plain text rather than downloaded as opaque attachments.
const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.sh', 'text/plain; charset=utf-8'],
  ['.ps1', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
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
  // normalize() collapses `..`, but a crafted path can still land outside the
  // root; compare the resolved prefix rather than trusting the input.
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return undefined
  return target
}

async function fileFor(target) {
  for (const candidate of [target, `${target}.html`, join(target, 'index.html')]) {
    try {
      const info = await stat(candidate)
      if (info.isFile()) return { path: candidate, size: info.size }
    } catch {
      continue // try the next spelling
    }
  }
  return undefined
}

const server = createServer((request, response) => {
  void (async () => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end('Method Not Allowed')
      return
    }
    const target = resolveTarget(request.url ?? '/')
    const found = target === undefined ? undefined : await fileFor(target)
    if (found === undefined) {
      // A staged file wins, so a local check can pin an artifact; otherwise the
      // release repository answers for the installer's two request shapes.
      const name = target === undefined ? '' : target.slice(ROOT.length).replace(/^[/\\]cli[/\\]?/u, '')
      const release = CHANNEL_NAMES.has(name) || BINARY_NAME.test(name)
      if (release) {
        try {
          if (CHANNEL_NAMES.has(name)) await serveChannel(response)
          else await serveBinary(name, response, request.method === 'HEAD')
        } catch (error) {
          process.stderr.write(`release lookup failed for ${name}: ${String(error)}\n`)
          response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
            .end('Release artifacts are temporarily unavailable.')
        }
        return
      }
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
  })()
})

server.listen(PORT, () => {
  process.stdout.write(`uamgo.com listening on :${PORT}\n`)
})
