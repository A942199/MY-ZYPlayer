'use strict'

const { parentPort, workerData } = require('worker_threads')
const vm = require('vm')
const http = require('http')
const https = require('https')
const zlib = require('zlib')
const crypto = require('crypto')
const { URL, URLSearchParams } = require('url')

if (workerData.modulePath) {
  process.env.NODE_PATH = workerData.modulePath
  require('module').Module._initPaths()
}

const cheerio = require('cheerio')
const CryptoJS = require('crypto-js')
const DEFAULT_TIMEOUT = 20000
const SCRIPT_TIMEOUT = 5000
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024

function argsify (value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (e) {
    return value
  }
}

function jsonify (value) {
  return JSON.stringify(value)
}

function redact (value) {
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch (e) {
    text = String(value)
  }
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer <REDACTED>')
    .replace(/(LOGIN_TOKEN\s*[=:]\s*)[^\s,;]+/gi, '$1<REDACTED>')
    .replace(/(Authorization\s*[=:]\s*)[^\s,;]+/gi, '$1<REDACTED>')
}

function safeConsole (sourceName) {
  function write (level, values) {
    const message = values.map(redact).join(' ')
    if (message) console[level]('[MyVideo:' + sourceName + '] ' + message)
  }
  return {
    log: (...values) => write('log', values),
    warn: (...values) => write('warn', values),
    error: (...values) => write('error', values)
  }
}

function parseCookie (header) {
  const first = String(header || '').split(';', 1)[0]
  const index = first.indexOf('=')
  if (index <= 0) return null
  return [first.slice(0, index).trim(), first.slice(index + 1).trim()]
}

function decodeBody (buffer, encoding) {
  const normalized = String(encoding || '').toLowerCase()
  if (normalized.includes('gzip')) return zlib.gunzipSync(buffer)
  if (normalized.includes('deflate')) return zlib.inflateSync(buffer)
  if (normalized.includes('br') && zlib.brotliDecompressSync) return zlib.brotliDecompressSync(buffer)
  return buffer
}

function compatibleJsonData (text) {
  // XPTV/MyVideo scripts overwhelmingly treat response.data as raw text.
  // Keep it a primitive string so typeof checks and JSON.parse behave exactly
  // like the source runtimes these scripts were written for.
  return String(text || '')
}

function compatibleResponseHeaders (headers) {
  const result = { ...(headers || {}) }
  const setCookie = result['set-cookie']
  if (setCookie) {
    result['Set-Cookie'] = Array.isArray(setCookie) ? setCookie[0] : setCookie
  }
  return result
}

class NativeHttpClient {
  constructor () {
    this.cookies = new Map()
  }

  cookieHeader (url) {
    const host = new URL(url).hostname
    const jar = this.cookies.get(host)
    return jar ? [...jar.entries()].map(([key, value]) => key + '=' + value).join('; ') : ''
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

  request (method, inputUrl, body, options = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
      let target
      try {
        target = new URL(inputUrl)
      } catch (error) {
        reject(error)
        return
      }
      const headers = { ...(options.headers || {}) }
      if (options.credentials === 'include' || options.withCredentials) {
        const cookie = this.cookieHeader(target.href)
        if (cookie && !headers.Cookie && !headers.cookie) headers.Cookie = cookie
      }
      if (!headers['Accept-Encoding'] && !headers['accept-encoding']) {
        headers['Accept-Encoding'] = 'gzip, deflate, br'
      }
      let payload = body
      if (payload !== undefined && payload !== null && !Buffer.isBuffer(payload) && typeof payload !== 'string') {
        const contentType = String(headers['Content-Type'] || headers['content-type'] || '').toLowerCase()
        if (contentType.includes('application/x-www-form-urlencoded')) {
          payload = Object.keys(payload).map(key => {
            const value = payload[key] === undefined || payload[key] === null ? '' : payload[key]
            return encodeURIComponent(key) + '=' + encodeURIComponent(String(value))
          }).join('&')
        } else {
          payload = JSON.stringify(payload)
          if (!contentType) headers['Content-Type'] = 'application/json'
        }
      }
      if (payload !== undefined && payload !== null && !headers['Content-Length'] && !headers['content-length']) {
        headers['Content-Length'] = Buffer.byteLength(payload)
      }
      const transport = target.protocol === 'https:' ? https : http
      const req = transport.request(target, {
        method,
        headers,
        timeout: Number(options.timeout) || DEFAULT_TIMEOUT
      }, res => {
        this.storeCookies(target.href, res.headers)
        const status = res.statusCode || 0
        const location = res.headers.location
        if ([301, 302, 303, 307, 308].includes(status) && location && redirects < (options.maxRedirects ?? 8)) {
          res.resume()
          const redirected = new URL(location, target).href
          const nextMethod = status === 303 ? 'GET' : method
          const nextBody = status === 303 ? undefined : payload
          this.request(nextMethod, redirected, nextBody, options, redirects + 1).then(resolve, reject)
          return
        }
        const chunks = []
        let responseBytes = 0
        const maxBytes = Number(options.maxBytes) || MAX_RESPONSE_BYTES
        res.on('data', chunk => {
          responseBytes += chunk.length
          if (responseBytes > maxBytes) {
            req.destroy(Object.assign(new Error('response too large'), { code: 'MYVIDEO_RESPONSE_TOO_LARGE' }))
            return
          }
          chunks.push(Buffer.from(chunk))
        })
        res.on('end', () => {
          try {
            const decoded = decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
            const rawData = decoded.toString('utf8')
            const data = compatibleJsonData(rawData)
            const responseHeaders = compatibleResponseHeaders(res.headers)
            resolve({
              status,
              statusCode: status,
              headers: responseHeaders,
              respHeaders: responseHeaders,
              data,
              url: target.href
            })
          } catch (error) {
            reject(error)
          }
        })
      })
      req.on('timeout', () => req.destroy(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })))
      req.on('error', reject)
      if (payload !== undefined && payload !== null) req.write(payload)
      req.end()
    })
  }

  get (url, options) {
    return this.request('GET', url, undefined, options)
  }

  post (url, body, options) {
    return this.request('POST', url, body, options)
  }
}

function loadFragment (input) {
  return cheerio.load(typeof input === 'string' ? input : String(input || ''))
}

function htmlHelpers () {
  return {
    elements (input, selector) {
      const $ = loadFragment(input)
      return $(selector).toArray().map(node => $.html(node))
    },
    text (input, selector) {
      const $ = loadFragment(input)
      return $(selector).first().text()
    },
    attr (input, selector, name) {
      const $ = loadFragment(input)
      return $(selector).first().attr(name)
    }
  }
}

class BigIntegerCompat {
  constructor (value, radix = 10) {
    if (typeof value === 'bigint') this.value = value
    else if (Buffer.isBuffer(value)) this.value = BigInt('0x' + (value.toString('hex') || '0'))
    else {
      const text = String(value || '0')
      this.value = radix === 16 ? BigInt('0x' + (text || '0')) : BigInt(text || '0')
    }
  }

  toString (radix = 10) {
    return this.value.toString(radix)
  }
}

function readDerNode (buffer, offset) {
  const tag = buffer[offset]
  let length = buffer[offset + 1]
  let header = 2
  if (length & 0x80) {
    const count = length & 0x7f
    length = 0
    for (let index = 0; index < count; index++) length = (length * 256) + buffer[offset + 2 + index]
    header += count
  }
  const start = offset + header
  return { tag, start, end: start + length }
}

function publicModulusBytes (key) {
  const der = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' })
  const outer = readDerNode(der, 0)
  const algorithm = readDerNode(der, outer.start)
  const bitString = readDerNode(der, algorithm.end)
  const rsaSequence = readDerNode(der, bitString.start + 1)
  const modulus = readDerNode(der, rsaSequence.start)
  let bytes = der.slice(modulus.start, modulus.end)
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.slice(1)
  return bytes
}

function bigIntegerBuffer (value, length) {
  let hex = value.toString(16)
  if (hex.length % 2) hex = '0' + hex
  let body = Buffer.from(hex, 'hex')
  if (body.length > length) body = body.slice(body.length - length)
  if (body.length < length) body = Buffer.concat([Buffer.alloc(length - body.length), body])
  return body
}

class JSEncryptCompat {
  setPublicKey (key) {
    this.publicKey = String(key || '')
  }

  setPrivateKey (key) {
    this.privateKey = String(key || '')
  }

  setKey (key) {
    const value = String(key || '')
    if (value.includes('PRIVATE KEY')) this.setPrivateKey(value)
    else this.setPublicKey(value)
  }

  getKey () {
    const publicKey = this.publicKey
    if (!publicKey) return null
    const modulus = publicModulusBytes(publicKey)
    const n = new BigIntegerCompat(modulus)
    return {
      n,
      doPublic: input => {
        const raw = crypto.publicDecrypt({
          key: publicKey,
          padding: crypto.constants.RSA_NO_PADDING
        }, bigIntegerBuffer(input.value, modulus.length))
        return new BigIntegerCompat(raw)
      }
    }
  }

  encrypt (value) {
    try {
      if (!this.publicKey) return false
      return crypto.publicEncrypt({
        key: this.publicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING
      }, Buffer.from(String(value), 'utf8')).toString('base64')
    } catch (error) {
      return false
    }
  }

  decrypt (value) {
    try {
      if (!this.privateKey) return false
      return crypto.privateDecrypt({
        key: this.privateKey,
        padding: crypto.constants.RSA_PKCS1_PADDING
      }, Buffer.from(String(value), 'base64')).toString('utf8')
    } catch (error) {
      return false
    }
  }
}

function storageApi (map) {
  return {
    get: key => map.get(String(key)),
    set: (key, value) => {
      map.set(String(key), value)
      return true
    },
    remove: key => map.delete(String(key)),
    clear: () => map.clear()
  }
}

function localStorageApi (map) {
  return {
    get length () {
      return map.size
    },
    key: index => [...map.keys()][Number(index)] || null,
    getItem: key => map.has(String(key)) ? String(map.get(String(key))) : null,
    setItem: (key, value) => map.set(String(key), String(value)),
    removeItem: key => map.delete(String(key)),
    clear: () => map.clear()
  }
}

const source = workerData.source || {}
const sourceName = source.name || source.key || 'source'
const httpClient = new NativeHttpClient()
const cache = new Map()
const logs = safeConsole(sourceName)
const sandbox = {
  $fetch: {
    get: (url, options) => httpClient.get(url, options),
    post: (url, body, options) => httpClient.post(url, body, options)
  },
  $cache: storageApi(cache),
  $storage: storageApi(cache),
  $config_str: JSON.stringify(source.config || {}),
  $html: htmlHelpers(),
  $print: (...values) => logs.log(...values),
  $utils: {
    openSafari: url => {
      const error = new Error('Source requires a real web context: ' + String(url || ''))
      error.code = 'MYVIDEO_WEBVIEW_REQUIRED'
      throw error
    }
  },
  $player: {},
  argsify,
  jsonify,
  createCheerio: () => cheerio,
  createCryptoJS: () => CryptoJS,
  loadJSEncrypt: () => JSEncryptCompat,
  b64encode: value => Buffer.from(String(value), 'utf8').toString('base64'),
  b64decode: value => Buffer.from(String(value), 'base64').toString('utf8'),
  atob: value => Buffer.from(String(value), 'base64').toString('binary'),
  btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
  URL,
  URLSearchParams,
  TextEncoder: global.TextEncoder,
  TextDecoder: global.TextDecoder,
  localStorage: localStorageApi(new Map()),
  sessionStorage: localStorageApi(new Map()),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  console: logs
}
sandbox.globalThis = sandbox
sandbox.self = sandbox

const context = vm.createContext(sandbox, {
  name: 'myvideo:' + sourceName,
  codeGeneration: {
    strings: workerData.allowDynamicCode === true,
    wasm: false
  }
})

let initError = null
try {
  const script = new vm.Script(workerData.code, { filename: source.ext || sourceName })
  script.runInContext(context, { timeout: SCRIPT_TIMEOUT })
} catch (error) {
  initError = {
    message: redact(error.message),
    code: error.code || 'MYVIDEO_SCRIPT_INIT'
  }
}

parentPort.postMessage(initError ? { type: 'fatal', error: initError } : { type: 'ready' })

parentPort.on('message', async message => {
  const id = message.id
  const method = message.method
  if (initError) {
    parentPort.postMessage({ id, error: initError })
    return
  }
  if (!['getConfig', 'getCards', 'getTracks', 'getPlayinfo', 'search', 'getLocalInfo'].includes(method)) {
    parentPort.postMessage({ id, error: { message: 'Unsupported MyVideo method: ' + method, code: 'MYVIDEO_METHOD' } })
    return
  }
  try {
    context.__myvideoArg = message.args === undefined ? undefined : JSON.stringify(message.args)
    const expression = '(typeof ' + method + ' === "function" ? ' + method + '(__myvideoArg) : Promise.reject(new Error("Missing function: ' + method + '")))'
    const result = new vm.Script(expression).runInContext(context, { timeout: SCRIPT_TIMEOUT })
    delete context.__myvideoArg
    const value = await Promise.resolve(result)
    parentPort.postMessage({ id, result: argsify(value) })
  } catch (error) {
    delete context.__myvideoArg
    parentPort.postMessage({
      id,
      error: { message: redact(error.message), code: error.code || 'MYVIDEO_RUNTIME' }
    })
  }
})
