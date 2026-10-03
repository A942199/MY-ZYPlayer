'use strict'

const crypto = require('crypto')
const http = require('http')
const https = require('https')
const { assertPublicHttpTarget } = require('../security/network-target')

const DEFAULT_TTL_MS = 10 * 60 * 1000
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024
const MAX_SCOPE_RESOURCES = 20000
const SENSITIVE_REDIRECT_HEADERS = /^(?:authorization|proxy-authorization|cookie2?|api-key|x-api-key|x-appsecret|x-app-secret)$/i

function normalizeHeaders (headers) {
  if (!headers) return {}
  if (!Array.isArray(headers)) {
    const out = {}
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) out[String(key)] = String(value)
    })
    return out
  }
  return headers.reduce((out, row) => {
    if (!row) return out
    if (typeof row === 'string') {
      const at = row.indexOf(':')
      if (at > 0) out[row.slice(0, at).trim()] = row.slice(at + 1).trim()
      return out
    }
    if (row.name) {
      out[String(row.name)] = String(row.value || '')
      return out
    }
    if (typeof row === 'object') {
      Object.entries(row).forEach(([key, value]) => {
        if (value !== undefined && value !== null) out[String(key)] = String(value)
      })
    }
    return out
  }, {})
}

function stripSensitiveHeadersForRedirect (headers, fromUrl, toUrl) {
  const next = { ...(headers || {}) }
  if (new URL(fromUrl).origin === new URL(toUrl).origin) return next
  Object.keys(next).forEach(key => {
    if (SENSITIVE_REDIRECT_HEADERS.test(key)) delete next[key]
  })
  return next
}

function safeExtension (rawUrl) {
  try {
    const match = new URL(rawUrl).pathname.match(/\.([a-z0-9]{1,8})$/i)
    return match ? '.' + match[1].toLowerCase() : ''
  } catch (error) {
    return ''
  }
}

function isManifestResponse (rawUrl, headers = {}) {
  const type = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase()
  if (type.includes('mpegurl') || type.includes('m3u8')) return true
  try {
    return new URL(rawUrl).pathname.toLowerCase().endsWith('.m3u8')
  } catch (error) {
    return false
  }
}

function responseHeader (headers, name) {
  const wanted = String(name).toLowerCase()
  const key = Object.keys(headers || {}).find(item => String(item).toLowerCase() === wanted)
  return key ? headers[key] : undefined
}

function copyRemoteHeaders (remoteHeaders = {}) {
  const allowed = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
    'content-disposition'
  ]
  const out = {}
  allowed.forEach(name => {
    const value = responseHeader(remoteHeaders, name)
    if (value !== undefined) out[name] = value
  })
  out['access-control-allow-origin'] = '*'
  out['access-control-allow-headers'] = '*'
  out['access-control-expose-headers'] = '*'
  return out
}

function writeHeaders (res, status, headers) {
  res.writeHead(status, headers)
}

function createPlaybackMediaProxy ({
  assertTarget = assertPublicHttpTarget,
  host = '127.0.0.1',
  defaultTtlMs = DEFAULT_TTL_MS,
  now = Date.now
} = {}) {
  const scopes = new Map()
  let server = null
  let port = 0
  let startPromise = null

  function prune () {
    const current = now()
    for (const [scopeId, scope] of scopes) {
      if (scope.expiresAt <= current) scopes.delete(scopeId)
    }
  }

  function touch (scope) {
    scope.expiresAt = now() + defaultTtlMs
  }

  function resourceKey (remoteUrl, headers) {
    return remoteUrl + '\u001f' + JSON.stringify(headers || {})
  }

  function localResourceUrl (scope, resource) {
    const suffix = safeExtension(resource.url)
    return 'http://' + host + ':' + port + '/media/' + scope.id + '/' + resource.id + '/resource' + suffix
  }

  function registerResource (scope, inputUrl, parentUrl, parentHeaders) {
    let target
    try {
      target = new URL(String(inputUrl || ''), parentUrl || undefined)
    } catch (error) {
      return null
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null

    const headers = parentUrl
      ? stripSensitiveHeadersForRedirect(parentHeaders || scope.headers, parentUrl, target.href)
      : { ...scope.headers }
    const key = resourceKey(target.href, headers)
    const existingId = scope.resourceKeys.get(key)
    if (existingId && scope.resources.has(existingId)) return scope.resources.get(existingId)
    if (scope.resources.size >= MAX_SCOPE_RESOURCES) throw new Error('Playback proxy resource limit exceeded')

    const resource = {
      id: crypto.randomBytes(12).toString('hex'),
      url: target.href,
      headers
    }
    scope.resources.set(resource.id, resource)
    scope.resourceKeys.set(key, resource.id)
    return resource
  }

  function rewriteManifest (text, baseUrl, scope, parentHeaders) {
    const rewriteUri = value => {
      const resource = registerResource(scope, value, baseUrl, parentHeaders)
      return resource ? localResourceUrl(scope, resource) : value
    }

    return String(text || '').split(/\r?\n/).map(line => {
      if (!line) return line
      if (line.startsWith('#')) {
        return line.replace(/URI=(["'])([^"']+)\1/g, (match, quote, uri) => {
          const rewritten = rewriteUri(uri)
          return 'URI=' + quote + rewritten + quote
        })
      }
      const leading = (line.match(/^\s*/) || [''])[0]
      const trailing = (line.match(/\s*$/) || [''])[0]
      const value = line.trim()
      if (!value) return line
      return leading + rewriteUri(value) + trailing
    }).join('\n')
  }

  async function requestRemote (clientReq, clientRes, scope, resource, redirects = 0) {
    if (redirects > 8) {
      clientRes.statusCode = 502
      clientRes.end('Too many redirects')
      return
    }

    let target
    try {
      target = await assertTarget(resource.url)
    } catch (error) {
      clientRes.statusCode = 403
      clientRes.end('Blocked playback target')
      return
    }

    const headers = { ...resource.headers }
    delete headers.Host
    delete headers.host
    delete headers.Connection
    delete headers.connection
    delete headers['Content-Length']
    delete headers['content-length']
    headers['Accept-Encoding'] = 'identity'
    if (clientReq.headers.range) headers.Range = clientReq.headers.range
    if (!headers.Accept && !headers.accept && clientReq.headers.accept) headers.Accept = clientReq.headers.accept

    const transport = target.protocol === 'https:' ? https : http
    const remoteReq = transport.request(target, {
      method: clientReq.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      timeout: 15000
    }, remoteRes => {
      const status = remoteRes.statusCode || 0
      const location = remoteRes.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        remoteRes.resume()
        const redirected = new URL(location, target).href
        const next = {
          ...resource,
          url: redirected,
          headers: stripSensitiveHeadersForRedirect(resource.headers, target.href, redirected)
        }
        requestRemote(clientReq, clientRes, scope, next, redirects + 1).catch(() => {})
        return
      }

      const manifest = clientReq.method !== 'HEAD' && status >= 200 && status < 300 && isManifestResponse(target.href, remoteRes.headers)
      if (!manifest) {
        writeHeaders(clientRes, status, copyRemoteHeaders(remoteRes.headers))
        remoteRes.on('error', () => {
          if (!clientRes.headersSent) clientRes.statusCode = 502
          clientRes.destroy()
        })
        remoteRes.pipe(clientRes)
        return
      }

      const chunks = []
      let size = 0
      remoteRes.on('data', chunk => {
        size += chunk.length
        if (size > MAX_MANIFEST_BYTES) {
          remoteReq.destroy(new Error('Playback manifest too large'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      remoteRes.on('end', () => {
        if (clientRes.destroyed) return
        const original = Buffer.concat(chunks).toString('utf8')
        const rewritten = rewriteManifest(original, target.href, scope, resource.headers)
        const body = Buffer.from(rewritten, 'utf8')
        const outHeaders = copyRemoteHeaders(remoteRes.headers)
        delete outHeaders['content-range']
        outHeaders['content-type'] = responseHeader(remoteRes.headers, 'content-type') || 'application/vnd.apple.mpegurl'
        outHeaders['content-length'] = String(body.length)
        writeHeaders(clientRes, status, outHeaders)
        clientRes.end(body)
      })
      remoteRes.on('error', error => {
        if (!clientRes.headersSent) {
          clientRes.statusCode = 502
          clientRes.end(String(error && error.message || 'Playback proxy response error'))
        } else {
          clientRes.destroy()
        }
      })
    })

    remoteReq.on('timeout', () => remoteReq.destroy(new Error('Playback proxy request timed out')))
    remoteReq.on('error', error => {
      if (!clientRes.headersSent) {
        clientRes.statusCode = 502
        clientRes.setHeader('access-control-allow-origin', '*')
        clientRes.end(String(error && error.message || 'Playback proxy request failed'))
      } else {
        clientRes.destroy()
      }
    })
    clientReq.once('aborted', () => remoteReq.destroy())
    remoteReq.end()
  }

  async function handleRequest (req, res) {
    prune()
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', '*')
    res.setHeader('access-control-expose-headers', '*')
    res.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS')

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end('Method not allowed')
      return
    }

    let pathname
    try {
      pathname = new URL(req.url, 'http://' + host).pathname
    } catch (error) {
      res.statusCode = 400
      res.end('Bad request')
      return
    }

    const match = pathname.match(/^\/media\/([a-f0-9]+)\/([a-f0-9]+)(?:\/|$)/i)
    if (!match) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    const scope = scopes.get(match[1])
    const resource = scope && scope.resources.get(match[2])
    if (!scope || !resource) {
      res.statusCode = 404
      res.end('Not found')
      return
    }

    touch(scope)
    await requestRemote(req, res, scope, resource)
  }

  async function start () {
    if (server && port) return port
    if (startPromise) return await startPromise
    startPromise = new Promise((resolve, reject) => {
      const next = http.createServer((req, res) => {
        handleRequest(req, res).catch(error => {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('access-control-allow-origin', '*')
            res.end(String(error && error.message || 'Playback proxy error'))
          } else {
            res.destroy()
          }
        })
      })
      next.once('error', reject)
      next.listen(0, host, () => {
        server = next
        port = next.address().port
        resolve(port)
      })
    }).finally(() => {
      startPromise = null
    })
    return await startPromise
  }

  async function prepare ({ url, headers } = {}) {
    const target = await assertTarget(url)
    await start()
    prune()
    while (scopes.size >= 32) scopes.delete(scopes.keys().next().value)

    const scope = {
      id: crypto.randomBytes(18).toString('hex'),
      headers: normalizeHeaders(headers),
      resources: new Map(),
      resourceKeys: new Map(),
      expiresAt: now() + defaultTtlMs
    }
    scopes.set(scope.id, scope)
    const initial = registerResource(scope, target.href)
    if (!initial) {
      scopes.delete(scope.id)
      throw new Error('Playback proxy target is invalid')
    }
    return {
      scopeId: scope.id,
      url: localResourceUrl(scope, initial)
    }
  }

  function release (scopeId) {
    return scopes.delete(String(scopeId || ''))
  }

  async function stop () {
    scopes.clear()
    if (!server) return
    const current = server
    server = null
    port = 0
    await new Promise(resolve => current.close(() => resolve()))
  }

  return {
    prepare,
    release,
    start,
    stop
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  createPlaybackMediaProxy,
  normalizeHeaders
}
