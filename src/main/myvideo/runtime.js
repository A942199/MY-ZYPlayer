const fs = require('fs')
const path = require('path')
const axios = require('axios')
const crypto = require('crypto')
const { Worker } = require('worker_threads')
const { URL } = require('url')
const { createPlaybackNetworkPolicy } = require('../playback/network-policy')
const { assertPublicHttpTarget } = require('../security/network-target')

const DEFAULT_TIMEOUT = 20000
const CALL_TIMEOUT = 30000
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const DYNAMIC_CODE_COMPATIBILITY = new Map([
  ['7sefun.js', 'legacy-provider-requires-string-code-generation'],
  ['novipnoad.js', 'legacy-provider-requires-string-code-generation'],
  ['saohuo.js', 'legacy-provider-requires-string-code-generation']
])
const playbackNetworkPolicy = createPlaybackNetworkPolicy()

function parseCookie (header) {
  const first = String(header || '').split(';', 1)[0]
  const index = first.indexOf('=')
  if (index <= 0) return null
  return [first.slice(0, index).trim(), first.slice(index + 1).trim()]
}

class NativeHttpClient {
  constructor (options = {}) {
    this.cookies = new Map()
    this.lookup = options.lookup
    this.allowPrivateNetwork = options.allowPrivateNetwork === true
    this.assertTarget = options.assertTarget || (url => assertPublicHttpTarget(url, {
      lookup: this.lookup,
      allowPrivateNetwork: this.allowPrivateNetwork
    }))
    this.requestImpl = options.requestImpl || axios
  }

  cookieHeader (url) {
    const host = new URL(url).hostname
    const jar = this.cookies.get(host)
    if (!jar) return ''
    return [...jar.entries()].map(([key, value]) => key + '=' + value).join('; ')
  }

  storeCookies (url, headers) {
    const setCookie = headers && headers['set-cookie']
    if (!setCookie) return
    const host = new URL(url).hostname
    const jar = this.cookies.get(host) || new Map()
    ;[].concat(setCookie).forEach(value => {
      const parsed = parseCookie(value)
      if (parsed) jar.set(parsed[0], parsed[1])
    })
    this.cookies.set(host, jar)
  }

  async request (method, url, body, options = {}) {
    let currentUrl = (await this.assertTarget(url)).toString()
    let currentMethod = String(method || 'GET').toUpperCase()
    let currentBody = body
    const maxRedirects = options.maxRedirects === undefined ? 8 : Math.max(0, Number(options.maxRedirects) || 0)

    for (let redirectCount = 0; ; redirectCount++) {
      const headers = { ...(options.headers || {}) }
      if (options.credentials === 'include' || options.withCredentials) {
        const cookie = this.cookieHeader(currentUrl)
        if (cookie && !headers.Cookie && !headers.cookie) headers.Cookie = cookie
      }
      const response = await this.requestImpl({
        method: currentMethod,
        url: currentUrl,
        data: currentBody,
        headers,
        timeout: Number(options.timeout) || DEFAULT_TIMEOUT,
        maxRedirects: 0,
        maxContentLength: Number(options.maxBytes) || MAX_RESPONSE_BYTES,
        maxBodyLength: Number(options.maxBytes) || MAX_RESPONSE_BYTES,
        responseType: options.responseType || 'text',
        transformResponse: [data => data],
        validateStatus: () => true
      })
      this.storeCookies(currentUrl, response.headers)

      const location = response.headers && (response.headers.location || response.headers.Location)
      const redirecting = [301, 302, 303, 307, 308].includes(response.status) && location
      if (redirecting) {
        if (redirectCount >= maxRedirects) throw new Error('Too many redirects')
        const next = new URL(Array.isArray(location) ? location[0] : location, currentUrl)
        currentUrl = (await this.assertTarget(next.toString())).toString()
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
          currentMethod = 'GET'
          currentBody = undefined
        }
        continue
      }

      let data = response.data
      if (typeof data === 'string') {
        const trimmed = data.trim()
        const contentType = String((response.headers && response.headers['content-type']) || '')
        if (trimmed && (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try {
            data = JSON.parse(trimmed)
          } catch (e) {}
        }
      }
      return {
        status: response.status,
        data,
        headers: response.headers,
        url: currentUrl
      }
    }
  }

  get (url, options) {
    return this.request('GET', url, undefined, options)
  }

  post (url, body, options) {
    return this.request('POST', url, body, options)
  }
}

function resolveWorkerPath () {
  const packagedWorker = process.resourcesPath
    ? path.join(process.resourcesPath, 'myvideo', 'runtime.worker.js')
    : null
  let isPackaged = false
  try {
    const electron = require('electron')
    isPackaged = Boolean(electron.app && electron.app.isPackaged)
  } catch (e) {}
  const candidates = []
  if (packagedWorker) candidates.push(packagedWorker)
  if (!isPackaged) {
    candidates.push(path.join(process.cwd(), 'src', 'main', 'myvideo', 'runtime.worker.js'))
    candidates.push(path.join(__dirname, 'runtime.worker.js'))
  }
  const workerPath = candidates.find(candidate => fs.existsSync(candidate))
  if (!workerPath) throw new Error('Unable to locate MyVideo runtime worker')
  return workerPath
}

function getModulePath () {
  try {
    const electron = require('electron')
    if (electron.app && typeof electron.app.getAppPath === 'function') {
      return path.join(electron.app.getAppPath(), 'node_modules')
    }
  } catch (e) {}
  return path.resolve(__dirname, '../../../node_modules')
}

function dynamicCodePolicy (source = {}) {
  try {
    const filename = new URL(source.ext).pathname.split('/').pop()
    const reason = DYNAMIC_CODE_COMPATIBILITY.get(filename) || ''
    return { enabled: Boolean(reason), reason }
  } catch (error) {
    return { enabled: false, reason: '' }
  }
}

function sha256Text (value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

function runtimeIdentity (source = {}, scriptHash = '') {
  const identity = String(source.key || source.api || source.ext || '')
  const config = source.config && typeof source.config === 'object'
    ? JSON.stringify(source.config)
    : String(source.config || '')
  const expectedHash = String(source.sha256 || (source.integrity && source.integrity.sha256) || '').toLowerCase()
  return [
    identity,
    String(source.ext || ''),
    String(source.network || 'native'),
    config,
    expectedHash,
    String(scriptHash || '').toLowerCase()
  ].join('\u001f')
}

function normalizeHeaders (headers) {
  if (Array.isArray(headers)) headers = headers[0] || {}
  const result = {}
  Object.entries(headers || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) result[String(key)] = String(value)
  })
  return result
}

class SourceWorker {
  constructor (source, code, options = {}) {
    this.source = source
    this.timeout = options.callTimeout || CALL_TIMEOUT
    const policy = dynamicCodePolicy(source)
    this.diagnostics = Object.freeze({
      sourceKey: String(source.key || source.api || ''),
      sourceUrl: String(source.ext || ''),
      scriptHash: String(options.scriptHash || sha256Text(code)),
      loadedAt: Number(options.loadedAt || Date.now()),
      dynamicCode: policy.enabled,
      dynamicCodeReason: policy.reason
    })
    this.nextId = 1
    this.pending = new Map()
    this.dead = false
    this.ready = false
    this.fatalError = null
    this.worker = new Worker(options.workerPath || resolveWorkerPath(), {
      workerData: {
        source,
        code,
        modulePath: options.modulePath || getModulePath(),
        allowDynamicCode: policy.enabled,
        integrity: this.diagnostics
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 96,
        maxYoungGenerationSizeMb: 24,
        codeRangeSizeMb: 16
      }
    })
    this.worker.on('message', message => this.onMessage(message))
    this.worker.on('error', error => this.failAll(error))
    this.worker.on('exit', code => {
      this.dead = true
      if (code !== 0) this.failAll(new Error('MyVideo source worker exited with code ' + code))
    })
  }

  onMessage (message) {
    if (message && message.type === 'ready') {
      this.ready = true
      return
    }
    if (message && message.type === 'fatal') {
      const error = Object.assign(new Error(message.error && message.error.message || 'Source initialization failed'), {
        code: message.error && message.error.code || 'MYVIDEO_SCRIPT_INIT'
      })
      this.fatalError = error
      this.failAll(error)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }))
    } else {
      pending.resolve(message.result)
    }
  }

  failAll (error) {
    this.dead = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  call (method, args) {
    if (this.fatalError) return Promise.reject(this.fatalError)
    if (this.dead) return Promise.reject(new Error('MyVideo source worker is not available'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(Object.assign(new Error(method + ' timed out'), { code: 'MYVIDEO_TIMEOUT' }))
        this.terminate()
      }, this.timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.worker.postMessage({ id, method, args })
    })
  }

  terminate () {
    if (!this.dead) {
      this.dead = true
      this.worker.terminate()
    }
  }
}

class RuntimeManager {
  constructor (options = {}) {
    this.runtimes = new Map()
    this.activeRuntimeKeys = new Map()
    this.lookup = options.lookup
    this.allowPrivateNetwork = options.allowPrivateNetwork === true
    this.loader = options.loader || new NativeHttpClient({
      lookup: this.lookup,
      allowPrivateNetwork: this.allowPrivateNetwork
    })
    this.modulePath = options.modulePath
    this.workerPath = options.workerPath
    this.callTimeout = options.callTimeout
  }

  baseKey (source) {
    return runtimeIdentity(source, '')
  }

  key (source, scriptHash = '') {
    return runtimeIdentity(source, scriptHash)
  }

  async runtimeFor (source) {
    if ((source.network || 'native') !== 'native') {
      const error = new Error('Source is configured for webview network mode')
      error.code = 'MYVIDEO_WEBVIEW_REQUIRED'
      throw error
    }
    const baseKey = this.baseKey(source)
    const activeKey = this.activeRuntimeKeys.get(baseKey)
    const existing = activeKey ? this.runtimes.get(activeKey) : null
    if (existing && !existing.dead) return existing
    if (activeKey) {
      this.runtimes.delete(activeKey)
      this.activeRuntimeKeys.delete(baseKey)
    }

    await assertPublicHttpTarget(source.ext, {
      lookup: this.lookup,
      allowPrivateNetwork: this.allowPrivateNetwork
    })
    const response = await this.loader.get(source.ext, { timeout: DEFAULT_TIMEOUT })
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Unable to load source script, HTTP ' + response.status)
    }
    await assertPublicHttpTarget(response.url || source.ext, {
      lookup: this.lookup,
      allowPrivateNetwork: this.allowPrivateNetwork
    })

    const code = String(response.data || '')
    const scriptHash = sha256Text(code)
    const expectedHash = String(source.sha256 || (source.integrity && source.integrity.sha256) || '').trim().toLowerCase()
    if (expectedHash && !/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('Invalid source SHA-256 pin')
    if (expectedHash && expectedHash !== scriptHash) {
      const error = new Error('Source SHA-256 mismatch')
      error.code = 'MYVIDEO_INTEGRITY'
      throw error
    }

    const key = this.key(source, scriptHash)
    const runtime = new SourceWorker(source, code, {
      modulePath: this.modulePath,
      workerPath: this.workerPath,
      callTimeout: this.callTimeout,
      scriptHash,
      loadedAt: Date.now()
    })
    runtime.runtimeKey = key
    runtime.baseKey = baseKey
    this.runtimes.set(key, runtime)
    this.activeRuntimeKeys.set(baseKey, key)
    return runtime
  }

  async call (source, method, args) {
    const runtime = await this.runtimeFor(source)
    try {
      return await runtime.call(method, args)
    } catch (error) {
      if (runtime.dead) {
        this.runtimes.delete(runtime.runtimeKey)
        this.activeRuntimeKeys.delete(runtime.baseKey)
      }
      throw error
    }
  }

  clear () {
    for (const runtime of this.runtimes.values()) runtime.terminate()
    this.runtimes.clear()
    this.activeRuntimeKeys.clear()
  }

  async loadConfig (url) {
    await assertPublicHttpTarget(url, {
      lookup: this.lookup,
      allowPrivateNetwork: this.allowPrivateNetwork
    })
    const response = await this.loader.get(url, { timeout: DEFAULT_TIMEOUT })
    await assertPublicHttpTarget(response.url || url, {
      lookup: this.lookup,
      allowPrivateNetwork: this.allowPrivateNetwork
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Unable to load source config, HTTP ' + response.status)
    }
    this.clear()
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  }
}

function registerPlaybackHeaders (url, headers, pathPrefix) {
  const normalized = normalizeHeaders(headers)
  if (!url || !Object.keys(normalized).length) return ''
  try {
    return playbackNetworkPolicy.registerScope({ url, pathPrefix, headers: normalized })
  } catch (error) {
    return ''
  }
}

function clearPlaybackHeaders (scopeId) {
  return playbackNetworkPolicy.clearScope(scopeId)
}

function applyPlaybackHeaders (url, requestHeaders) {
  return playbackNetworkPolicy.applyRequest(url, requestHeaders)
}

function applyPlaybackResponseHeaders (url, responseHeaders) {
  return playbackNetworkPolicy.applyResponse(url, responseHeaders)
}

const manager = new RuntimeManager({ allowPrivateNetwork: process.env.MY_ZYPLAYER_ALLOW_PRIVATE_SOURCE_TESTS === '1' })

async function callMyVideo (payload = {}) {
  const source = payload.source || {}
  return await manager.call(source, payload.method, payload.args)
}

async function loadMyVideoConfig (url) {
  return await manager.loadConfig(url)
}

function clearMyVideoRuntimes () {
  manager.clear()
  return true
}

function setPlaybackHeaders (payload = {}) {
  const scopeId = registerPlaybackHeaders(payload.url, payload.headers, payload.pathPrefix)
  return { scopeId }
}

function clearPlaybackHeaderScope (payload = {}) {
  return clearPlaybackHeaders(payload.scopeId)
}

function registerMyVideoIpc (ipcMain) {
  ipcMain.handle('myvideo:call', (event, payload) => callMyVideo(payload))
  ipcMain.handle('myvideo:load-config', (event, url) => loadMyVideoConfig(url))
  ipcMain.handle('myvideo:clear-runtimes', () => clearMyVideoRuntimes())
  ipcMain.handle('myvideo:set-playback-headers', (event, payload) => setPlaybackHeaders(payload))
}

module.exports = {
  NativeHttpClient,
  SourceWorker,
  RuntimeManager,
  dynamicCodePolicy,
  runtimeIdentity,
  sha256Text,
  callMyVideo,
  loadMyVideoConfig,
  clearMyVideoRuntimes,
  setPlaybackHeaders,
  clearPlaybackHeaderScope,
  registerMyVideoIpc,
  registerPlaybackHeaders,
  clearPlaybackHeaders,
  applyPlaybackHeaders,
  applyPlaybackResponseHeaders
}
