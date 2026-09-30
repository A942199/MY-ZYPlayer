'use strict'

const crypto = require('crypto')

const DEFAULT_TTL_MS = 10 * 60 * 1000

function normalizePathPrefix (value) {
  let path = String(value || '/').trim()
  if (!path.startsWith('/')) path = '/' + path
  return path
}

function defaultPathPrefix (url) {
  const pathname = url.pathname || '/'
  if (!pathname.toLowerCase().endsWith('.m3u8')) return normalizePathPrefix(pathname)
  const slash = pathname.lastIndexOf('/')
  return normalizePathPrefix(pathname.slice(0, slash + 1) || '/')
}

function createPlaybackNetworkPolicy ({ now = Date.now, defaultTtlMs = DEFAULT_TTL_MS } = {}) {
  const scopes = new Map()

  function prune () {
    const current = now()
    for (const [id, scope] of scopes) {
      if (scope.expiresAt <= current) scopes.delete(id)
    }
  }

  function registerScope ({ url, pathPrefix, headers, ttlMs } = {}) {
    const target = new URL(String(url || ''))
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new TypeError('Playback scope URL must use http or https')
    }

    const normalizedHeaders = {}
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) normalizedHeaders[String(key)] = String(value)
    })
    if (!Object.keys(normalizedHeaders).length) throw new TypeError('Playback scope requires headers')

    const ttl = Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0 ? Number(ttlMs) : defaultTtlMs
    const id = crypto.randomBytes(16).toString('hex')
    scopes.set(id, {
      id,
      origin: target.origin,
      pathPrefix: normalizePathPrefix(pathPrefix || defaultPathPrefix(target)),
      headers: normalizedHeaders,
      expiresAt: now() + ttl
    })
    return id
  }

  function clearScope (scopeId) {
    return scopes.delete(String(scopeId || ''))
  }

  function matchingScope (rawUrl) {
    prune()
    let target
    try {
      target = new URL(String(rawUrl || ''))
    } catch (error) {
      return null
    }

    for (const scope of scopes.values()) {
      if (scope.origin === target.origin && target.pathname.startsWith(scope.pathPrefix)) return scope
    }
    return null
  }

  function applyRequest (url, requestHeaders = {}) {
    const scope = matchingScope(url)
    return scope ? { ...(requestHeaders || {}), ...scope.headers } : requestHeaders
  }

  function applyResponse (url, responseHeaders = {}) {
    if (!matchingScope(url)) return responseHeaders
    return {
      ...(responseHeaders || {}),
      'access-control-allow-origin': ['*'],
      'access-control-allow-headers': ['*'],
      'access-control-expose-headers': ['*']
    }
  }

  return {
    registerScope,
    clearScope,
    applyRequest,
    applyResponse
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  createPlaybackNetworkPolicy
}
