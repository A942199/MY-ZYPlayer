'use strict'

const http = require('http')
const https = require('https')
const zlib = require('zlib')
const cheerio = require('cheerio')

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36'
const MAX_BODY = 3 * 1024 * 1024

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
        resolve({
          status,
          headers: res.headers,
          body: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']),
          url: target.href
        })
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
  const response = await requestText('https://movie.douban.com/j/search_subjects?' + query.toString(), {
    headers: { Accept: 'application/json,text/plain,*/*', Referer: 'https://movie.douban.com/' }
  })
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
  const response = await requestText('https://www.douban.com/search?cat=1002&q=' + encodeURIComponent(text), {
    headers: { Referer: 'https://www.douban.com/' }
  })
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
      kind: 'unknown'
    })
  })
  return { list }
}

function infoValue (text, label) {
  const match = String(text || '').match(new RegExp('(?:^|\\n)\\s*' + label + '\\s*:\\s*([^\\n]+)', 'i'))
  return match ? match[1].trim() : ''
}

function firstYear (value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/)
  return match ? Number(match[0]) : null
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

async function subjectFingerprint (id, title) {
  if (!title) return null
  try {
    const response = await requestText('https://www.douban.com/search?cat=1002&q=' + encodeURIComponent(title), {
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

async function subjectDetail (payload = {}) {
  const id = String(payload.id || '').replace(/[^0-9]/g, '')
  if (!id) throw new Error('Douban subject id is required')
  const response = await requestText('https://movie.douban.com/subject/' + id + '/', {
    maxBytes: MAX_BODY,
    headers: { Referer: 'https://movie.douban.com/' }
  })
  if (response.status !== 200) throw new Error('Douban detail HTTP ' + response.status)
  const $ = cheerio.load(response.text)
  const info = $('#info').text().replace(/\r/g, '')
  const episodeCount = Number(infoValue(info, '集数')) || null
  const kind = payload.kind === 'tv' || (episodeCount && episodeCount > 1)
    ? 'tv'
    : (payload.kind === 'movie' ? 'movie' : 'unknown')
  const title = $('span[property="v:itemreviewed"]').first().text().trim() || String(payload.title || '').trim()
  const fingerprint = await subjectFingerprint(id, title)
  return {
    id,
    title,
    originalTitle: infoValue(info, '原名') || (fingerprint && fingerprint.originalTitle) || '',
    aliases: infoValue(info, '又名').split('/').map(value => value.trim()).filter(Boolean),
    year: firstYear($('.year').first().text()) || (fingerprint && fingerprint.year) || Number(payload.year) || null,
    kind,
    rate: $('strong[property="v:average"]').first().text().trim() || String(payload.rate || ''),
    cover: String($('#mainpic img').first().attr('src') || payload.cover || ''),
    summary: $('span[property="v:summary"]').first().text().replace(/\s+/g, ' ').trim(),
    directors: $('a[rel="v:directedBy"]').map((i, el) => $(el).text().trim()).get().filter(Boolean).concat(
      fingerprint && fingerprint.director ? [fingerprint.director] : []
    ).filter((value, index, array) => array.indexOf(value) === index),
    casts: $('a[rel="v:starring"]').map((i, el) => $(el).text().trim()).get().filter(Boolean).concat(
      fingerprint && fingerprint.cast ? [fingerprint.cast] : []
    ).filter((value, index, array) => array.indexOf(value) === index),
    genres: $('span[property="v:genre"]').map((i, el) => $(el).text().trim()).get().filter(Boolean),
    episodeCount,
    fingerprint: (fingerprint && fingerprint.text) || '',
    url: 'https://movie.douban.com/subject/' + id + '/'
  }
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
  ipcMain.handle('douban:probe', (event, payload) => probeUrl(payload))
}

module.exports = { listSubjects, searchSubjects, subjectDetail, probeUrl, registerDoubanIpc }
