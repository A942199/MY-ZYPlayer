'use strict'

const http = require('http')
const https = require('https')
const zlib = require('zlib')

const DEFAULT_BASE_URL = 'https://video.zi-quan.com'
const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_SUBTITLE_BYTES = 3 * 1024 * 1024
const REQUEST_TIMEOUT = 12000

function normalizeCompanionConfig (input = {}) {
  const raw = String(input.baseUrl || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL
  let url
  try {
    url = new URL(raw)
  } catch (error) {
    throw new Error('字幕/弹幕服务地址无效')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('字幕/弹幕服务仅支持 HTTP/HTTPS')
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback) throw new Error('远程字幕/弹幕服务必须使用 HTTPS')
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return {
    baseUrl: url.toString().replace(/\/$/, ''),
    password: String(input.password || '').trim()
  }
}

function decodeBody (buffer, encoding) {
  const value = String(encoding || '').toLowerCase()
  if (value.includes('gzip')) return zlib.gunzipSync(buffer)
  if (value.includes('deflate')) return zlib.inflateSync(buffer)
  if (value.includes('br')) return zlib.brotliDecompressSync(buffer)
  return buffer
}

function requestBuffer (targetUrl, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('字幕/弹幕服务重定向过多'))
    let target
    try {
      target = new URL(targetUrl)
    } catch (error) {
      return reject(new Error('字幕/弹幕请求地址无效'))
    }
    if (!['http:', 'https:'].includes(target.protocol)) return reject(new Error('字幕/弹幕请求协议不支持'))

    const transport = target.protocol === 'https:' ? https : http
    const body = options.body ? Buffer.from(options.body) : null
    const headers = {
      Accept: options.accept || 'application/json,text/plain,*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': 'MY-ZYPlayer/2.9 media-enhancement',
      ...(options.headers || {})
    }
    if (body) headers['Content-Length'] = String(body.length)

    const req = transport.request(target, {
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: true
    }, res => {
      const status = Number(res.statusCode || 0)
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const next = new URL(res.headers.location, target)
        if (options.allowedOrigin && next.origin !== options.allowedOrigin) {
          res.resume()
          return reject(new Error('字幕/弹幕服务禁止跨域重定向'))
        }
        res.resume()
        requestBuffer(next.href, options, redirects + 1).then(resolve).catch(reject)
        return
      }

      const chunks = []
      let bytes = 0
      const maxBytes = Number(options.maxBytes) || MAX_JSON_BYTES
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          req.destroy(new Error('字幕/弹幕服务响应过大'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      res.on('end', () => {
        try {
          const decoded = decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
          if (decoded.length > maxBytes) throw new Error('字幕/弹幕服务响应过大')
          resolve({ status, headers: res.headers, body: decoded, url: target.href })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(Number(options.timeout) || REQUEST_TIMEOUT, () => req.destroy(new Error('字幕/弹幕服务请求超时')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

function authHeaders (config, extra = {}) {
  return {
    ...extra,
    ...(config.password ? { 'x-password': config.password } : {})
  }
}

function endpointUrl (config, pathname) {
  const base = new URL(config.baseUrl)
  const target = new URL(pathname, base.origin)
  const basePath = base.pathname.replace(/\/$/, '')
  if (basePath) target.pathname = basePath + (pathname.startsWith('/') ? pathname : '/' + pathname)
  return target
}

async function requestJson (config, pathname, payload, options = {}) {
  const target = endpointUrl(config, pathname)
  const body = payload === undefined ? null : JSON.stringify(payload)
  const response = await requestBuffer(target.href, {
    method: body == null ? 'GET' : 'POST',
    body,
    maxBytes: options.maxBytes || MAX_JSON_BYTES,
    allowedOrigin: target.origin,
    headers: authHeaders(config, body == null ? {} : { 'Content-Type': 'application/json' })
  })
  let data = {}
  try {
    data = JSON.parse(response.body.toString('utf8') || '{}')
  } catch (error) {
    throw new Error('字幕/弹幕服务返回了无效 JSON')
  }
  if (response.status === 401) throw new Error('字幕/弹幕服务认证失败，请在设置中填写 MyVideo 访问密码')
  if (response.status === 429) throw new Error('字幕/弹幕服务请求过于频繁，请稍后重试')
  if (response.status < 200 || response.status >= 300) {
    throw new Error(String(data.error || data.message || ('字幕/弹幕服务 HTTP ' + response.status)))
  }
  return data
}

async function resolveDanmaku (payload = {}) {
  const config = normalizeCompanionConfig(payload.config)
  const media = payload.media && typeof payload.media === 'object' ? payload.media : {}
  if (!String(media.title || '').trim()) throw new Error('缺少弹幕匹配标题')
  return await requestJson(config, '/api/danmaku/resolve', { ...media, force: payload.force === true })
}

async function resolveSubtitles (payload = {}) {
  const config = normalizeCompanionConfig(payload.config)
  const media = payload.media && typeof payload.media === 'object' ? payload.media : {}
  if (!String(media.title || media.tmdbId || '').trim()) throw new Error('缺少字幕匹配信息')
  const suffix = payload.force === true ? '?force=1' : ''
  const data = await requestJson(config, '/api/subtitles/resolve' + suffix, media)
  const sourceCandidates = Array.isArray(data.candidates) ? data.candidates : []
  const candidates = sourceCandidates.filter(item => item && (item.language === 'ja' || item.language === 'ja-zh'))
  const originalAutoIndex = Number(data.autoSelectIndex)
  let autoSelectIndex = -1
  if (Number.isInteger(originalAutoIndex) && originalAutoIndex >= 0 && sourceCandidates[originalAutoIndex]) {
    const selected = sourceCandidates[originalAutoIndex]
    autoSelectIndex = candidates.findIndex(item =>
      item === selected ||
      (
        String(item.provider || '') === String(selected.provider || '') &&
        String(item.providerRef || '') === String(selected.providerRef || '')
      )
    )
  }
  return { ...data, candidates, autoSelectIndex }
}

async function fetchSubtitle (payload = {}) {
  const config = normalizeCompanionConfig(payload.config)
  const raw = String(payload.fetchUrl || '').trim()
  if (!raw) throw new Error('字幕下载地址为空')
  const base = new URL(config.baseUrl)
  const target = raw.startsWith('http://') || raw.startsWith('https://')
    ? new URL(raw)
    : endpointUrl(config, raw)
  const basePath = base.pathname.replace(/\/$/, '')
  const expectedPath = basePath + '/api/subtitles/fetch'
  if (target.origin !== base.origin || target.pathname !== expectedPath) {
    throw new Error('字幕下载地址不可信')
  }
  const response = await requestBuffer(target.href, {
    maxBytes: MAX_SUBTITLE_BYTES,
    allowedOrigin: base.origin,
    accept: 'text/vtt,text/plain,*/*',
    headers: authHeaders(config)
  })
  if (response.status === 401) throw new Error('字幕服务认证失败')
  if (response.status === 429) throw new Error('字幕源限流，请稍后重试')
  if (response.status < 200 || response.status >= 300) {
    const code = String(response.headers['x-subtitle-error'] || '')
    throw new Error(code || ('字幕下载 HTTP ' + response.status))
  }
  const text = response.body.toString('utf8')
  if (!text.includes('-->')) throw new Error('字幕文件没有有效 cue')
  return {
    text,
    language: String(response.headers['x-subtitle-language'] || response.headers['content-language'] || ''),
    contentType: String(response.headers['content-type'] || 'text/vtt')
  }
}

function registerMediaEnhancementIpc (ipcMain) {
  ipcMain.handle('media-enhancement:danmaku-resolve', (event, payload) => resolveDanmaku(payload))
  ipcMain.handle('media-enhancement:subtitle-resolve', (event, payload) => resolveSubtitles(payload))
  ipcMain.handle('media-enhancement:subtitle-fetch', (event, payload) => fetchSubtitle(payload))
}

module.exports = {
  DEFAULT_BASE_URL,
  normalizeCompanionConfig,
  requestBuffer,
  resolveDanmaku,
  resolveSubtitles,
  fetchSubtitle,
  registerMediaEnhancementIpc
}
