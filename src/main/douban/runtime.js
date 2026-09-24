'use strict'

const http = require('http')
const https = require('https')
const zlib = require('zlib')
const cheerio = require('cheerio')

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36'
const MAX_BODY = 3 * 1024 * 1024
const DETAIL_TIMEOUT = 6000
const FINGERPRINT_TIMEOUT = 4500
const DOUBAN_MOVIE_ORIGIN = String(process.env.MY_ZYPLAYER_DOUBAN_MOVIE_ORIGIN || 'https://movie.douban.com').replace(/\/+$/, '')
const DOUBAN_SEARCH_ORIGIN = String(process.env.MY_ZYPLAYER_DOUBAN_SEARCH_ORIGIN || 'https://www.douban.com').replace(/\/+$/, '')
const IMAGE_MAX_BYTES = 2 * 1024 * 1024
const IMAGE_CACHE_MAX_BYTES = 48 * 1024 * 1024
const IMAGE_CACHE_LIMIT = 64
const imageDataCache = new Map()
let imageDataCacheBytes = 0

function normalizeHeaders (headers) {
  if (!headers) return {}
  if (Array.isArray(headers)) {
    return headers.reduce((out, row) => {
      if (!row) return out
      if (typeof row === 'string') {
        const at = row.indexOf(':')
        if (at > 0) out[row.slice(0, at).trim()] = row.slice(at + 1).trim()
      } else if (row.name) {
        out[row.name] = row.value || ''
      } else if (typeof row === 'object') {
        Object.assign(out, row)
      }
      return out
    }, {})
  }
  return { ...headers }
}

function decodeBody (buffer, encoding) {
  try {
    if (String(encoding || '').includes('gzip')) return zlib.gunzipSync(buffer)
    if (String(encoding || '').includes('deflate')) return zlib.inflateSync(buffer)
    if (String(encoding || '').includes('br')) return zlib.brotliDecompressSync(buffer)
  } catch (error) {}
  return buffer
}

function requestBuffer (url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'))
    let target
    try {
      target = new URL(url)
    } catch (error) {
      reject(new Error('Invalid URL'))
      return
    }
    if (!['http:', 'https:'].includes(target.protocol)) {
      reject(new Error('Unsupported URL protocol'))
      return
    }
    const transport = target.protocol === 'https:' ? https : http
    const headers = {
      'User-Agent': USER_AGENT,
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      ...normalizeHeaders(options.headers)
    }
    const req = transport.request(target, {
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: options.rejectUnauthorized !== false
    }, res => {
      const status = res.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume()
        requestBuffer(new URL(res.headers.location, target).href, options, redirects + 1).then(resolve).catch(reject)
        return
      }
      const chunks = []
      let size = 0
      const maxBytes = options.maxBytes || MAX_BODY
      res.on('data', chunk => {
        size += chunk.length
        if (size <= maxBytes) chunks.push(chunk)
        else req.destroy(new Error('Response too large'))
      })
      res.on('end', () => {
        try {
          const body = decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
          if (body.length > maxBytes) throw new Error('Response too large')
          resolve({
            status,
            headers: res.headers,
            body,
            url: target.href
          })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(options.timeout || 10000, () => req.destroy(new Error('Request timed out')))
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

async function requestText (url, options = {}) {
  const response = await requestBuffer(url, options)
  return { ...response, text: response.body.toString('utf8') }
}

async function requestTextWithRetry (url, options = {}, attempts = 2) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await requestText(url, options)
    } catch (error) {
      lastError = error
      if (attempt + 1 >= attempts) break
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)))
    }
  }
  throw lastError
}

function normalizeSubject (item, kind) {
  return {
    id: String(item.id || ''),
    title: String(item.title || '').trim(),
    url: String(item.url || ''),
    cover: String(item.cover || ''),
    rate: String(item.rate || ''),
    episodesInfo: String(item.episodes_info || ''),
    kind: kind === 'tv' ? 'tv' : 'movie',
    directors: Array.isArray(item.directors) ? item.directors : [],
    casts: Array.isArray(item.casts) ? item.casts : []
  }
}

async function listSubjects (payload = {}) {
  const kind = payload.kind === 'tv' ? 'tv' : 'movie'
  const tag = String(payload.tag || '热门').trim() || '热门'
  const start = Math.max(0, Number(payload.start) || 0)
  const limit = Math.min(50, Math.max(1, Number(payload.limit) || 24))
  const query = new URLSearchParams({
    type: kind,
    tag,
    sort: String(payload.sort || 'recommend'),
    page_limit: String(limit),
    page_start: String(start)
  })
  const response = await requestTextWithRetry(DOUBAN_MOVIE_ORIGIN + '/j/search_subjects?' + query.toString(), {
    headers: { Accept: 'application/json,text/plain,*/*', Referer: 'https://movie.douban.com/' }
  }, 3)
  if (response.status !== 200) throw new Error('Douban HTTP ' + response.status)
  const data = JSON.parse(response.text)
  return {
    list: (data.subjects || []).map(item => normalizeSubject(item, kind)),
    kind,
    tag,
    start,
    limit
  }
}

async function searchSubjects (payload = {}) {
  const text = String(payload.text || '').trim()
  if (!text) return { list: [] }
  const response = await requestTextWithRetry(DOUBAN_SEARCH_ORIGIN + '/search?cat=1002&q=' + encodeURIComponent(text), {
    headers: { Referer: 'https://www.douban.com/' }
  }, 3)
  if (response.status !== 200) throw new Error('Douban search HTTP ' + response.status)
  const $ = cheerio.load(response.text)
  const list = []
  $('div.result').slice(0, 30).each((index, element) => {
    const anchor = $(element).find('h3 a').first()
    let href = String(anchor.attr('href') || '')
    try {
      const wrapped = new URL(href)
      const target = wrapped.searchParams.get('url')
      if (target) href = decodeURIComponent(target)
    } catch (error) {}
    const idMatch = href.match(/movie\.douban\.com\/subject\/(\d+)/)
    if (!idMatch) return
    const cast = $(element).find('.subject-cast').text().replace(/\s+/g, ' ').trim()
    const yearMatch = cast.match(/(?:19|20)\d{2}/)
    list.push({
      id: idMatch[1],
      title: anchor.text().replace(/\s+/g, ' ').replace(/\s*[-–—]\s*豆瓣.*$/i, '').trim(),
      url: 'https://movie.douban.com/subject/' + idMatch[1] + '/',
      cover: String($(element).find('img').attr('src') || ''),
      rate: String($(element).find('.rating_nums').text() || '').trim(),
      year: yearMatch ? Number(yearMatch[0]) : null,
      kind: 'unknown',
      searchMeta: cast
    })
  })
  const japaneseQuery = /[\u3040-\u30ff]/.test(text)
  const filtered = payload.japanOnly
    ? list.filter(item => japaneseQuery || isLikelyJapaneseSearchText(item.searchMeta))
    : list
  return {
    list: filtered.map(item => {
      const { searchMeta, ...subject } = item
      return subject
    })
  }
}

function infoValue (text, label) {
  const match = String(text || '').match(new RegExp('(?:^|\\n)\\s*' + label + '\\s*:\\s*([^\\n]+)', 'i'))
  return match ? match[1].trim() : ''
}

function firstYear (value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/)
  return match ? Number(match[0]) : null
}

function splitInfoValue (value) {
  return String(value || '').split('/').map(item => item.trim()).filter(Boolean)
}

function isLikelyJapaneseSearchText (value) {
  const text = String(value || '')
  const original = (text.match(/原名\s*:\s*([^/]+)/i) || [])[1] || ''
  return /[\u3040-\u30ff]/.test(original) || /(?:日本|日语|日本語)/.test(text)
}

function subjectIdFromHref (href) {
  let target = String(href || '')
  try {
    const wrapped = new URL(target)
    const nested = wrapped.searchParams.get('url')
    if (nested) target = nested
  } catch (error) {}
  const match = target.match(/movie\.douban\.com\/subject\/(\d+)/)
  return match ? match[1] : ''
}

async function subjectFingerprint (id, title, options = {}) {
  if (!title) return null
  const request = options.requestText || requestText
  try {
    const response = await request(DOUBAN_SEARCH_ORIGIN + '/search?cat=1002&q=' + encodeURIComponent(title), {
      timeout: Math.min(6000, Math.max(1500, Number(options.timeout) || FINGERPRINT_TIMEOUT)),
      headers: { Referer: 'https://www.douban.com/' }
    })
    if (response.status !== 200) return null
    const $ = cheerio.load(response.text)
    let result = null
    $('div.result').slice(0, 20).each((index, element) => {
      if (result) return
      const anchor = $(element).find('h3 a').first()
      if (subjectIdFromHref(anchor.attr('href')) !== String(id)) return
      const castText = $(element).find('.subject-cast').text().replace(/\s+/g, ' ').trim()
      const pieces = castText.split('/').map(value => value.trim()).filter(Boolean)
      result = {
        year: firstYear(castText),
        originalTitle: String(pieces[0] || '').replace(/^原名\s*:/, '').trim(),
        director: pieces[1] && !/(?:19|20)\d{2}/.test(pieces[1]) ? pieces[1] : '',
        cast: pieces[2] && !/(?:19|20)\d{2}/.test(pieces[2]) ? pieces[2] : '',
        text: castText
      }
    })
    return result
  } catch (error) {
    return null
  }
}

function uniqueStrings (values) {
  const list = Array.isArray(values) ? values : (values === undefined || values === null ? [] : [values])
  return list
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
}

function subjectKind (payload, episodeCount) {
  if (payload.kind === 'tv' || (episodeCount && episodeCount > 1)) return 'tv'
  if (payload.kind === 'movie') return 'movie'
  return 'unknown'
}

function fallbackSubjectDetail (payload, id, fingerprint, error) {
  return {
    id,
    title: String(payload.title || '').trim(),
    originalTitle: (fingerprint && fingerprint.originalTitle) || String(payload.originalTitle || '').trim(),
    aliases: uniqueStrings(payload.aliases),
    year: (fingerprint && fingerprint.year) || firstYear(payload.year) || null,
    kind: subjectKind(payload, Number(payload.episodeCount) || null),
    rate: String(payload.rate || ''),
    cover: String(payload.cover || ''),
    summary: String(payload.summary || ''),
    directors: uniqueStrings([...(Array.isArray(payload.directors) ? payload.directors : []), fingerprint && fingerprint.director]),
    casts: uniqueStrings([...(Array.isArray(payload.casts) ? payload.casts : []), fingerprint && fingerprint.cast]),
    genres: uniqueStrings(payload.genres),
    regions: uniqueStrings(payload.regions),
    languages: uniqueStrings(payload.languages),
    episodeCount: Number(payload.episodeCount) || null,
    fingerprint: (fingerprint && fingerprint.text) || '',
    url: 'https://movie.douban.com/subject/' + id + '/',
    detailStatus: fingerprint ? 'partial' : 'degraded',
    detailError: error ? String(error.message || error) : ''
  }
}

async function subjectDetail (payload = {}, dependencies = {}) {
  const id = String(payload.id || '').replace(/[^0-9]/g, '')
  if (!id) throw new Error('Douban subject id is required')

  const titleHint = String(payload.title || '').trim()
  const fetchDetail = dependencies.requestText || requestText
  const fetchFingerprint = dependencies.subjectFingerprint || subjectFingerprint
  const detailUrl = DOUBAN_MOVIE_ORIGIN + '/subject/' + id + '/'

  const [detailResult, fingerprintResult] = await Promise.allSettled([
    fetchDetail(detailUrl, {
      maxBytes: MAX_BODY,
      timeout: DETAIL_TIMEOUT,
      headers: { Referer: 'https://movie.douban.com/' }
    }),
    fetchFingerprint(id, titleHint, { timeout: FINGERPRINT_TIMEOUT })
  ])

  const fingerprint = fingerprintResult.status === 'fulfilled' ? fingerprintResult.value : null
  let detailError = null
  let response = null

  if (detailResult.status === 'fulfilled') {
    response = detailResult.value
    if (!response || response.status !== 200) {
      detailError = new Error('Douban detail HTTP ' + (response ? response.status : 0))
      response = null
    }
  } else {
    detailError = detailResult.reason
  }

  if (!response) return fallbackSubjectDetail(payload, id, fingerprint, detailError)

  try {
    const $ = cheerio.load(response.text)
    const info = $('#info').text().replace(/\r/g, '')
    const episodeCount = Number(infoValue(info, '集数')) || null
    const kind = subjectKind(payload, episodeCount)
    const title = $('span[property="v:itemreviewed"]').first().text().trim() || titleHint
    return {
      id,
      title,
      originalTitle: infoValue(info, '原名') || (fingerprint && fingerprint.originalTitle) || '',
      aliases: uniqueStrings(infoValue(info, '又名').split('/')),
      year: firstYear($('.year').first().text()) || (fingerprint && fingerprint.year) || firstYear(payload.year) || null,
      kind,
      rate: $('strong[property="v:average"]').first().text().trim() || String(payload.rate || ''),
      cover: String($('#mainpic img').first().attr('src') || payload.cover || ''),
      summary: $('span[property="v:summary"]').first().text().replace(/\s+/g, ' ').trim(),
      directors: uniqueStrings(
        $('a[rel="v:directedBy"]').map((i, el) => $(el).text().trim()).get()
          .concat(fingerprint && fingerprint.director ? [fingerprint.director] : [])
      ),
      casts: uniqueStrings(
        $('a[rel="v:starring"]').map((i, el) => $(el).text().trim()).get()
          .concat(fingerprint && fingerprint.cast ? [fingerprint.cast] : [])
      ),
      genres: uniqueStrings($('span[property="v:genre"]').map((i, el) => $(el).text().trim()).get()),
      regions: splitInfoValue(infoValue(info, '制片国家/地区')),
      languages: splitInfoValue(infoValue(info, '语言')),
      episodeCount,
      fingerprint: (fingerprint && fingerprint.text) || '',
      url: 'https://movie.douban.com/subject/' + id + '/',
      detailStatus: 'full',
      detailError: ''
    }
  } catch (error) {
    return fallbackSubjectDetail(payload, id, fingerprint, error)
  }
}

async function fetchImageData (payload = {}) {
  const url = String(payload.url || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('Douban image URL is invalid')
  if (imageDataCache.has(url)) {
    const cached = imageDataCache.get(url)
    imageDataCache.delete(url)
    imageDataCache.set(url, cached)
    return cached.result
  }

  const response = await requestBuffer(url, {
    maxBytes: IMAGE_MAX_BYTES,
    timeout: 12000,
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: 'https://movie.douban.com/'
    }
  })
  if (response.status !== 200) throw new Error('Douban image HTTP ' + response.status)
  const contentType = String(response.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
  if (!contentType.startsWith('image/')) throw new Error('Douban image content type is invalid')
  const result = {
    url,
    contentType,
    dataUrl: 'data:' + contentType + ';base64,' + response.body.toString('base64')
  }
  const bytes = response.body.length
  imageDataCache.set(url, { result, bytes })
  imageDataCacheBytes += bytes
  while (imageDataCache.size > IMAGE_CACHE_LIMIT || imageDataCacheBytes > IMAGE_CACHE_MAX_BYTES) {
    const oldestKey = imageDataCache.keys().next().value
    const oldest = imageDataCache.get(oldestKey)
    imageDataCache.delete(oldestKey)
    imageDataCacheBytes = Math.max(0, imageDataCacheBytes - (oldest ? oldest.bytes : 0))
  }
  return result
}

function firstMediaUri (manifest, baseUrl) {
  for (const raw of String(manifest || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    try {
      return new URL(line, baseUrl).href
    } catch (error) {}
  }
  return ''
}

async function probeUrl (payload = {}) {
  const url = String(payload.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return { ok: false, code: 'INVALID_URL' }
  const headers = normalizeHeaders(payload.headers)
  const timeout = Math.min(6500, Math.max(1500, Number(payload.timeout) || 4500))
  try {
    const first = await requestBuffer(url, {
      timeout,
      maxBytes: 1024 * 1024,
      headers: { ...headers, Range: headers.Range || headers.range || 'bytes=0-262143' }
    })
    if (![200, 206].includes(first.status)) return { ok: false, code: 'HTTP_' + first.status, status: first.status }
    const contentType = String(first.headers['content-type'] || '').toLowerCase()
    const text = first.body.toString('utf8')
    const isHls = /\.m3u8(?:$|[?#])/i.test(first.url) || contentType.includes('mpegurl') || text.includes('#EXTM3U')
    if (!isHls) {
      const direct = contentType.startsWith('video/') || /\.(?:mp4|m4v)(?:$|[?#])/i.test(first.url)
      return { ok: direct && first.body.length > 0, kind: direct ? 'direct' : 'unknown', status: first.status, bytes: first.body.length }
    }
    let manifest = text
    let manifestUrl = first.url
    if (manifest.includes('#EXT-X-STREAM-INF')) {
      const nestedUrl = firstMediaUri(manifest, manifestUrl)
      if (!nestedUrl) return { ok: false, code: 'HLS_NO_VARIANT' }
      const nested = await requestText(nestedUrl, { timeout, maxBytes: 1024 * 1024, headers })
      if (![200, 206].includes(nested.status)) return { ok: false, code: 'HLS_VARIANT_HTTP_' + nested.status }
      manifest = nested.text
      manifestUrl = nested.url
    }
    const fragmentUrl = firstMediaUri(manifest, manifestUrl)
    if (!fragmentUrl) return { ok: false, code: 'HLS_NO_FRAGMENT' }
    const fragment = await requestBuffer(fragmentUrl, {
      timeout,
      maxBytes: 256 * 1024,
      headers: { ...headers, Range: headers.Range || headers.range || 'bytes=0-131071' }
    })
    return {
      ok: [200, 206].includes(fragment.status) && fragment.body.length > 0,
      kind: 'hls',
      status: fragment.status,
      bytes: fragment.body.length,
      manifestUrl,
      fragmentUrl
    }
  } catch (error) {
    return { ok: false, code: error.code || 'PROBE_ERROR', error: error.message }
  }
}

function registerDoubanIpc (ipcMain) {
  ipcMain.handle('douban:list', (event, payload) => listSubjects(payload))
  ipcMain.handle('douban:search', (event, payload) => searchSubjects(payload))
  ipcMain.handle('douban:detail', (event, payload) => subjectDetail(payload))
  ipcMain.handle('douban:image', (event, payload) => fetchImageData(payload))
  ipcMain.handle('douban:probe', (event, payload) => probeUrl(payload))
}

module.exports = { listSubjects, searchSubjects, subjectDetail, fetchImageData, probeUrl, registerDoubanIpc }
