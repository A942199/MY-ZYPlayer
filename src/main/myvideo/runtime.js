const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { Worker } = require('worker_threads')
const { URL } = require('url')

const DEFAULT_TIMEOUT = 20000
const CALL_TIMEOUT = 30000
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024
const DYNAMIC_CODE_FILES = new Set(['7sefun.js', 'novipnoad.js', 'saohuo.js'])
const playbackHeaders = new Map()

function parseCookie (header) {
  const first = String(header || '').split(';', 1)[0]
  const index = first.indexOf('=')
  if (index <= 0) return null
  return [first.slice(0, index).trim(), first.slice(index + 1).trim()]
}

class NativeHttpClient {
  constructor () {
    this.cookies = new Map()
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
    const headers = { ...(options.headers || {}) }
    if (options.credentials === 'include' || options.withCredentials) {
      const cookie = this.cookieHeader(url)
      if (cookie && !headers.Cookie && !headers.cookie) headers.Cookie = cookie
    }
    const response = await axios({
      method,
      url,
      data: body,
      headers,
      timeout: Number(options.timeout) || DEFAULT_TIMEOUT,
      maxRedirects: options.maxRedirects === undefined ? 8 : options.maxRedirects,
      maxContentLength: Number(options.maxBytes) || MAX_RESPONSE_BYTES,
      maxBodyLength: Number(options.maxBytes) || MAX_RESPONSE_BYTES,
      responseType: options.responseType || 'text',
      transformResponse: [data => data],
      validateStatus: () => true
    })
    this.storeCookies(url, response.headers)
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
      url: (response.request && response.request.res && response.request.res.responseUrl) || url
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

function allowDynamicCode (source) {
  if (source.allowDynamicCode === true) return true
  try {
    const filename = new URL(source.ext).pathname.split('/').pop()
    return DYNAMIC_CODE_FILES.has(filename)
  } catch (e) {
    return false
  }
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
        allowDynamicCode: allowDynamicCode(source)
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
    this.loader = options.loader || new NativeHttpClient()
    this.modulePath = options.modulePath
    this.workerPath = options.workerPath
    this.callTimeout = options.callTimeout
  }

  key (source) {
    return String(source.key || source.api || source.ext)
  }

  async runtimeFor (source) {
    if ((source.network || 'native') !== 'native') {
      const error = new Error('Source is configured for webview network mode')
      error.code = 'MYVIDEO_WEBVIEW_REQUIRED'
      throw error
    }
    const key = this.key(source)
    const existing = this.runtimes.get(key)
    if (existing && !existing.dead) return existing
    if (existing) this.runtimes.delete(key)
    const response = await this.loader.get(source.ext, { timeout: DEFAULT_TIMEOUT })
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Unable to load source script, HTTP ' + response.status)
    }
    const runtime = new SourceWorker(source, String(response.data || ''), {
      modulePath: this.modulePath,
      workerPath: this.workerPath,
      callTimeout: this.callTimeout
    })
    this.runtimes.set(key, runtime)
    return runtime
  }

  async call (source, method, args) {
    const runtime = await this.runtimeFor(source)
    try {
      return await runtime.call(method, args)
    } catch (error) {
      if (runtime.dead) this.runtimes.delete(this.key(source))
      throw error
    }
  }

  clear () {
    for (const runtime of this.runtimes.values()) runtime.terminate()
    this.runtimes.clear()
  }

  async loadConfig (url) {
    const response = await this.loader.get(url, { timeout: DEFAULT_TIMEOUT })
    if (response.status < 200 || response.status >= 300) {
      throw new Error('Unable to load source config, HTTP ' + response.status)
    }
    this.clear()
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  }
}

function registerPlaybackHeaders (url, headers) {
  const normalized = normalizeHeaders(headers)
  if (!url || !Object.keys(normalized).length) return
  try {
    playbackHeaders.set(new URL(url).origin, {
      headers: normalized,
      expiresAt: Date.now() + (10 * 60 * 1000)
    })
  } catch (e) {}
}

function applyPlaybackHeaders (url, requestHeaders) {
  try {
    const origin = new URL(url).origin
    const rule = playbackHeaders.get(origin)
    if (!rule) return requestHeaders
    if (rule.expiresAt < Date.now()) {
      playbackHeaders.delete(origin)
      return requestHeaders
    }
    return { ...(requestHeaders || {}), ...rule.headers }
  } catch (e) {
    return requestHeaders
  }
}

const manager = new RuntimeManager()

function registerMyVideoIpc (ipcMain) {
  ipcMain.handle('myvideo:call', async (event, payload) => {
    const source = (payload && payload.source) || {}
    return await manager.call(source, payload && payload.method, payload && payload.args)
  })
  ipcMain.handle('myvideo:load-config', async (event, url) => {
    return await manager.loadConfig(url)
  })
  ipcMain.handle('myvideo:clear-runtimes', async () => {
    manager.clear()
    return true
  })
  ipcMain.handle('myvideo:set-playback-headers', async (event, payload) => {
    registerPlaybackHeaders(payload && payload.url, payload && payload.headers)
    return true
  })
}

module.exports = {
  NativeHttpClient,
  SourceWorker,
  RuntimeManager,
  registerMyVideoIpc,
  registerPlaybackHeaders,
  applyPlaybackHeaders
}
