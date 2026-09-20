import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('./public', import.meta.url)))
const PORT = Number(process.env.PORT ?? 3000)

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
  // normalize() collapses `..`, but a crafted path can still land outside the
  // root; compare the resolved prefix rather than trusting the input.
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return undefined
  return target
}

// `uamgo.com/install.sh` is the advertised install command, but the script
// itself belongs to the release it installs. Redirecting keeps one copy: the
// asset published with the newest release, rather than a copy here that drifts.
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
  })()
})

server.listen(PORT, () => {
  process.stdout.write(`uamgo.com listening on :${PORT}\n`)
})
