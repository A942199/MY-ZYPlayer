'use strict'

const http = require('http')
const https = require('https')
const zlib = require('zlib')
const crypto = require('crypto')

const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_SUBTITLE_BYTES = 3 * 1024 * 1024
const REQUEST_TIMEOUT = 7000
const CACHE_TTL = 30 * 60 * 1000
const danmakuCache = new Map()
const subtitleCandidateCache = new Map()

function cleanText (value, max = 512) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function normalizeTitle (value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/第\s*\d+\s*[季期]/g, ' ')
    .replace(/(?:^|[^a-z0-9])s(?:eason)?\s*0*\d+(?=$|[^a-z0-9])/gi, ' ')
    .replace(/[\s\-_.:：·・、，。！？!?'"“”‘’()（）\[\]【】{}<>《》/\\|]+/g, '')
}

function uniqueStrings (values, limit = 8) {
  const seen = new Set()
  const out = []
  const add = value => {
    if (value == null || out.length >= limit) return
    if (Array.isArray(value)) return value.forEach(add)
    const raw = cleanText(value, 200)
    const key = normalizeTitle(raw)
    if (!raw || !key || seen.has(key)) return
    seen.add(key)
    out.push(raw)
  }
  add(values)
  return out
}

function safeInt (value, min, max) {
  if (value == null || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

function parseNumbers (value) {
  const text = String(value || '').normalize('NFKC')
  let season = null
  let episode = null
  let match = text.match(/(?:^|[^a-z0-9])s(?:eason)?\s*0*(\d{1,3})\s*[-_. ]*e(?:p(?:isode)?)?\s*0*(\d{1,4})(?:\D|$)/i)
  if (match) {
    season = safeInt(match[1], 0, 200)
    episode = safeInt(match[2], 0, 10000)
  }
  if (season == null) {
    match = text.match(/第\s*0*(\d{1,3})\s*季/) || text.match(/(?:^|[^a-z0-9])s(?:eason)?\s*0*(\d{1,3})(?:\D|$)/i)
    if (match) season = safeInt(match[1], 0, 200)
  }
  if (episode == null) {
    match = text.match(/第\s*0*(\d{1,4})\s*(?:集|話|话)/) || text.match(/(?:^|[^a-z0-9])e(?:p(?:isode)?)?\s*0*(\d{1,4})(?:\D|$)/i)
    if (match) episode = safeInt(match[1], 0, 10000)
  }
  return { season, episode }
}

function cleanUrl (value, fallback = '') {
  const raw = cleanText(value || fallback, 2048).replace(/\/+$/, '')
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return ''
  }
}

function normalizeLocalConfig (input = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const danmaku = source.danmaku && typeof source.danmaku === 'object' ? source.danmaku : {}
  const subtitles = source.subtitles && typeof source.subtitles === 'object' ? source.subtitles : {}
  return {
    danmaku: {
      dandanplayAppId: cleanText(danmaku.dandanplayAppId, 200),
      dandanplayAppSecret: cleanText(danmaku.dandanplayAppSecret, 300),
      compatibleUrls: uniqueStrings(danmaku.compatibleUrls || [], 12).map(url => cleanUrl(url)).filter(Boolean),
      compatibleToken: cleanText(danmaku.compatibleToken, 500),
      dandanplayBaseUrl: cleanUrl(danmaku.dandanplayBaseUrl, 'https://api.dandanplay.net') || 'https://api.dandanplay.net'
    },
    subtitles: {
      jimakuApiKey: cleanText(subtitles.jimakuApiKey, 500),
      assrtApiToken: cleanText(subtitles.assrtApiToken, 500),
      openSubtitlesApiKey: cleanText(subtitles.openSubtitlesApiKey, 500),
      openSubtitlesUserAgent: cleanText(subtitles.openSubtitlesUserAgent || 'MY-ZYPlayer v2.9', 200),
      subdlApiKey: cleanText(subtitles.subdlApiKey, 500),
      jimakuBaseUrl: cleanUrl(subtitles.jimakuBaseUrl, 'https://jimaku.cc') || 'https://jimaku.cc',
      assrtBaseUrl: cleanUrl(subtitles.assrtBaseUrl, 'https://api.assrt.net') || 'https://api.assrt.net',
      openSubtitlesBaseUrl: cleanUrl(subtitles.openSubtitlesBaseUrl, 'https://api.opensubtitles.com') || 'https://api.opensubtitles.com',
      subdlBaseUrl: cleanUrl(subtitles.subdlBaseUrl, 'https://api.subdl.com') || 'https://api.subdl.com'
    }
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
    if (redirects > 4) return reject(new Error('请求重定向过多'))
    let target
    try { target = new URL(targetUrl) } catch (error) { return reject(new Error('请求地址无效')) }
    if (!['http:', 'https:'].includes(target.protocol)) return reject(new Error('请求协议不支持'))
    if (target.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) return reject(new Error('远程提供方必须使用 HTTPS'))
    const transport = target.protocol === 'https:' ? https : http
    const body = options.body ? Buffer.from(options.body) : null
    const headers = {
      Accept: options.accept || 'application/json,text/plain,*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': options.userAgent || 'MY-ZYPlayer/2.9 local-media-enhancement',
      ...(options.headers || {})
    }
    if (body) headers['Content-Length'] = String(body.length)
    const req = transport.request(target, { method: options.method || 'GET', headers, rejectUnauthorized: true }, res => {
      const status = Number(res.statusCode || 0)
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        const next = new URL(res.headers.location, target)
        if (options.allowedHosts && !options.allowedHosts.some(host => next.hostname === host || next.hostname.endsWith('.' + host))) {
          res.resume()
          return reject(new Error('禁止跳转到未知字幕/弹幕域名'))
        }
        res.resume()
        return requestBuffer(next.href, options, redirects + 1).then(resolve).catch(reject)
      }
      const chunks = []
      let bytes = 0
      const maxBytes = Number(options.maxBytes) || MAX_JSON_BYTES
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) return req.destroy(new Error('提供方响应过大'))
        chunks.push(Buffer.from(chunk))
      })
      res.on('end', () => {
        try {
          const decoded = decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
          if (decoded.length > maxBytes) throw new Error('提供方响应过大')
          resolve({ status, headers: res.headers, body: decoded, url: target.href })
        } catch (error) { reject(error) }
      })
    })
    req.setTimeout(Number(options.timeout) || REQUEST_TIMEOUT, () => req.destroy(new Error('提供方请求超时')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function requestJson (url, options = {}) {
  const response = await requestBuffer(url, {
    ...options,
    accept: 'application/json',
    headers: { ...(options.headers || {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
  })
  let data
  try { data = JSON.parse(response.body.toString('utf8') || '{}') } catch (error) { throw new Error('提供方返回无效 JSON') }
  if (response.status === 429) throw new Error('provider_rate_limited')
  if (response.status < 200 || response.status >= 300) throw new Error('provider_http_' + response.status)
  return data
}

function cacheGet (map, key) {
  const row = map.get(key)
  if (!row || row.expiresAt <= Date.now()) {
    if (row) map.delete(key)
    return null
  }
  return row.value
}

function cacheSet (map, key, value, ttl = CACHE_TTL) {
  map.set(key, { value, expiresAt: Date.now() + ttl })
  while (map.size > 128) map.delete(map.keys().next().value)
  return value
}

function mediaKey (media) {
  return [cleanText(media.tmdbId || ''), normalizeTitle(media.title), media.year || '', media.kind || '', media.season == null ? '' : media.season, media.episode == null ? '' : media.episode].join('|')
}

function titleScore (media, candidate) {
  const wanted = uniqueStrings([media.title, media.originalTitle, media.aliases], 12).map(normalizeTitle).filter(Boolean)
  const got = normalizeTitle(candidate)
  if (!got) return 0
  let score = 0
  for (const title of wanted) {
    if (title === got) score = Math.max(score, 100)
    else if (Math.min(title.length, got.length) >= 2 && (title.includes(got) || got.includes(title))) score = Math.max(score, 84)
  }
  return score
}

function walkObjects (value, out = [], depth = 0) {
  if (depth > 5 || value == null) return out
  if (Array.isArray(value)) {
    value.slice(0, 400).forEach(item => walkObjects(item, out, depth + 1))
    return out
  }
  if (typeof value !== 'object') return out
  out.push(value)
  Object.values(value).forEach(child => {
    if (Array.isArray(child) || (child && typeof child === 'object')) walkObjects(child, out, depth + 1)
  })
  return out
}

function firstValue (obj, keys) {
  for (const key of keys) if (obj && obj[key] != null && String(obj[key]).trim()) return String(obj[key]).trim()
  return ''
}

function danmakuEpisodeCandidates (data, media) {
  const out = []
  const seen = new Set()

  const push = (obj, inherited = {}) => {
    const episodeId = firstValue(obj, ['episodeId', 'episode_id', 'commentId', 'comment_id'])
    if (!episodeId || seen.has(episodeId)) return
    const title = firstValue(obj, ['animeTitle', 'anime_title', 'bangumiTitle', 'seriesTitle']) || inherited.title || firstValue(obj, ['title', 'name'])
    const episodeTitle = firstValue(obj, ['episodeTitle', 'episode_title', 'subtitle', 'episodeName', 'name'])
    const rawEpisode = obj.episode != null ? obj.episode : (obj.episodeNumber != null ? obj.episodeNumber : obj.episodeNo)
    const parsedEpisode = safeInt(rawEpisode, 0, 10000)
    const episode = parsedEpisode != null ? parsedEpisode : parseNumbers(episodeTitle).episode
    const yearText = firstValue(obj, ['year', 'animeYear', 'releaseYear']) || inherited.year || title
    const yearMatch = String(yearText || '').match(/(?:18|19|20|21)\d{2}/)
    const year = yearMatch ? Number(yearMatch[0]) : null
    const score = titleScore(media, title)
    if (score < 84) return
    if (media.year && year && Number(media.year) !== year) return
    if (media.episode != null && episode != null && Number(media.episode) !== episode) return
    if (media.episode != null && episode == null) return
    seen.add(episodeId)
    out.push({ episodeId, title, episodeTitle, score: score + (episode === Number(media.episode) ? 30 : 0) + (year === Number(media.year) ? 10 : 0) })
  }

  for (const parent of walkObjects(data)) {
    const episodes = Array.isArray(parent && parent.episodes) ? parent.episodes : (Array.isArray(parent && parent.episodeList) ? parent.episodeList : null)
    if (!episodes || !episodes.length) continue
    const title = firstValue(parent, ['animeTitle', 'anime_title', 'bangumiTitle', 'seriesTitle', 'title', 'name'])
    const year = firstValue(parent, ['year', 'animeYear', 'releaseYear'])
    episodes.slice(0, 500).forEach(episode => push(episode, { title, year }))
  }
  for (const obj of walkObjects(data)) push(obj)
  return out.sort((a, b) => b.score - a.score)
}

function providerUrl (base, pathname, query = {}) {
  const url = new URL(pathname.replace(/^\/+/, ''), base.replace(/\/+$/, '') + '/')
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  })
  return url.toString()
}

async function searchDanmakuProvider (provider, media) {
  const aliases = uniqueStrings([media.originalTitle, media.title, media.aliases], 4)
  for (const alias of aliases) {
    try {
      const direct = await requestJson(providerUrl(provider.baseUrl, '/api/v2/search/episodes', {
        anime: alias,
        episode: media.episode == null ? undefined : media.episode,
        tmdbId: media.tmdbId || undefined,
        v2: 'true'
      }), { headers: provider.headers, timeout: 3500 })
      const best = danmakuEpisodeCandidates(direct, media)[0]
      if (best) return best
    } catch (error) {}
  }
  return null
}

function normalizeDanmakuComments (data) {
  let raw = []
  if (Array.isArray(data)) raw = data
  else if (Array.isArray(data && data.comments)) raw = data.comments
  else if (Array.isArray(data && data.comment)) raw = data.comment
  else if (Array.isArray(data && data.list)) raw = data.list
  else if (Array.isArray(data && data.data)) raw = data.data
  const out = []
  for (const item of raw.slice(0, 16000)) {
    if (!item) continue
    let time = Number(item.time != null ? item.time : item.progress != null ? item.progress : item.timestamp)
    if (typeof item.p === 'string') time = Number(item.p.split(',')[0])
    if (time > 100000) time /= 1000
    if (!Number.isFinite(time) || time < 0 || time > 86400) continue
    const text = cleanText(item.m != null ? item.m : item.text != null ? item.text : item.content, 300).replace(/[\r\n\t]+/g, ' ')
    if (!text) continue
    const modeValue = item.mode != null ? item.mode : item.type != null ? item.type : (typeof item.p === 'string' ? item.p.split(',')[1] : 1)
    const modeNum = Number(modeValue)
    const mode = modeNum === 5 || String(modeValue).toLowerCase() === 'top' ? 'top' : (modeNum === 4 || String(modeValue).toLowerCase() === 'bottom' ? 'bottom' : 'scroll')
    const rawColor = item.color != null ? item.color : (typeof item.p === 'string' ? item.p.split(',')[2] : '')
    let color = String(rawColor || '')
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      const n = Number(rawColor)
      color = Number.isFinite(n) && n >= 0 && n <= 0xffffff ? '#' + Math.floor(n).toString(16).padStart(6, '0') : '#ffffff'
    }
    out.push({ time: Math.round(time * 1000) / 1000, mode, color, text })
    if (out.length >= 8000) break
  }
  return out.sort((a, b) => a.time - b.time)
}

async function resolveDanmaku (payload = {}) {
  const config = normalizeLocalConfig(payload.config)
  const media = payload.media && typeof payload.media === 'object' ? payload.media : {}
  if (!cleanText(media.title)) throw new Error('缺少弹幕匹配标题')
  const key = mediaKey(media)
  if (!payload.force) {
    const cached = cacheGet(danmakuCache, key)
    if (cached) return { ...cached, cached: true }
  }
  const providers = []
  if (config.danmaku.dandanplayAppId && config.danmaku.dandanplayAppSecret) {
    providers.push({ id: 'dandanplay', name: '弹弹play', baseUrl: config.danmaku.dandanplayBaseUrl, headers: { 'X-AppId': config.danmaku.dandanplayAppId, 'X-AppSecret': config.danmaku.dandanplayAppSecret } })
  }
  config.danmaku.compatibleUrls.forEach((baseUrl, index) => {
    providers.push({ id: 'compatible-' + index, name: '兼容弹幕源 ' + (index + 1), baseUrl, headers: config.danmaku.compatibleToken ? { Authorization: 'Bearer ' + config.danmaku.compatibleToken } : {} })
  })
  if (!providers.length) return { enabled: false, matched: false, comments: [], provider: '', providerName: '', reason: 'unconfigured' }
  const failures = []
  for (const provider of providers) {
    try {
      const match = await searchDanmakuProvider(provider, media)
      if (!match) continue
      const data = await requestJson(providerUrl(provider.baseUrl, '/api/v2/comment/' + encodeURIComponent(match.episodeId), { withRelated: 'true', chConvert: 1 }), { headers: provider.headers, timeout: 4000, maxBytes: 6 * 1024 * 1024 })
      const comments = normalizeDanmakuComments(data)
      if (!comments.length) continue
      return cacheSet(danmakuCache, key, { enabled: true, matched: true, provider: provider.id, providerName: provider.name, episodeId: match.episodeId, comments, failover: failures.length > 0 }, 6 * 60 * 60 * 1000)
    } catch (error) {
      failures.push({ provider: provider.id, code: cleanText(error && error.message || error, 100) })
    }
  }
  return { enabled: true, matched: false, comments: [], failures, transientFailure: failures.length === providers.length }
}

function classifySubtitleLanguage (value, fileName = '') {
  const text = (String(value || '') + ' ' + String(fileName || '')).toLowerCase().normalize('NFKC')
  const ja = /(?:^|[^a-z])(ja|jpn|japanese)(?:[^a-z]|$)|日本語|日语|日語/.test(text)
  const zh = /(?:^|[^a-z])(zh|zho|chi|chinese)(?:[^a-z]|$)|中文|简体|簡體|繁体|繁體/.test(text)
  if (ja && zh) return 'ja-zh'
  if (ja) return 'ja'
  return ''
}

function candidateCompatible (candidate, media) {
  const numbers = parseNumbers(candidate.fileName)
  if (media.season != null && numbers.season != null && Number(media.season) !== numbers.season) return false
  if (media.episode != null && numbers.episode != null && Number(media.episode) !== numbers.episode) return false
  return true
}

function addCandidate (out, candidate, media) {
  if (!candidate || !candidate.downloadUrl) return
  candidate.language = classifySubtitleLanguage(candidate.language, candidate.fileName)
  if (!['ja', 'ja-zh'].includes(candidate.language)) return
  if (!candidateCompatible(candidate, media)) return
  let score = Number(candidate.score || 0) + (candidate.language === 'ja-zh' ? 20 : 10)
  const numbers = parseNumbers(candidate.fileName)
  if (media.episode != null && numbers.episode === Number(media.episode)) score += 50
  if (media.season != null && numbers.season === Number(media.season)) score += 25
  candidate.score = score
  out.push(candidate)
}

async function searchJimaku (config, media) {
  if (!config.jimakuApiKey) return []
  const headers = { Authorization: config.jimakuApiKey, Accept: 'application/json' }
  const out = []
  for (const alias of uniqueStrings([media.originalTitle, media.title, media.aliases], 4)) {
    const data = await requestJson(config.jimakuBaseUrl + '/api/entries/search?' + new URLSearchParams({ query: alias }), { headers, timeout: 3500 })
    const entries = Array.isArray(data) ? data : Array.isArray(data && data.entries) ? data.entries : []
    const ranked = entries.map(entry => ({ entry, score: titleScore(media, entry && (entry.name || entry.title || entry.english_name || entry.japanese_name)) })).filter(row => row.score >= 84).sort((a, b) => b.score - a.score).slice(0, 3)
    for (const row of ranked) {
      const url = new URL(config.jimakuBaseUrl + '/api/entries/' + encodeURIComponent(row.entry.id) + '/files')
      if (media.episode != null) url.searchParams.set('episode', String(media.episode))
      const filesData = await requestJson(url.toString(), { headers, timeout: 3500 })
      const files = Array.isArray(filesData) ? filesData : Array.isArray(filesData && filesData.files) ? filesData.files : []
      for (const file of files) {
        const fileName = cleanText(file.name || file.filename, 300)
        addCandidate(out, { provider: 'jimaku', providerRef: String(row.entry.id) + ':' + fileName, language: classifySubtitleLanguage(file.language, fileName) || 'ja', fileName, downloadUrl: cleanText(file.url, 2048), headers, score: row.score }, media)
      }
    }
    if (out.length) break
  }
  return out
}

function openSubtitlesQueries (media) {
  const out = []
  const kind = media.kind === 'tv' || media.season != null || media.episode != null ? 'episode' : 'movie'
  if (/^\d+$/.test(String(media.tmdbId || ''))) {
    const q = new URLSearchParams({ languages: 'ja,zh-cn,zh-tw', type: kind })
    if (kind === 'episode') q.set('parent_tmdb_id', String(media.tmdbId))
    else q.set('tmdb_id', String(media.tmdbId))
    if (media.season != null) q.set('season_number', String(media.season))
    if (media.episode != null) q.set('episode_number', String(media.episode))
    out.push(q)
  }
  uniqueStrings([media.originalTitle, media.title, media.aliases], 2).forEach(title => {
    const q = new URLSearchParams({ languages: 'ja,zh-cn,zh-tw', type: kind, query: title })
    if (media.season != null) q.set('season_number', String(media.season))
    if (media.episode != null) q.set('episode_number', String(media.episode))
    out.push(q)
  })
  return out.slice(0, 3)
}

async function searchOpenSubtitles (config, media) {
  if (!config.openSubtitlesApiKey || !config.openSubtitlesUserAgent) return []
  const headers = { 'Api-Key': config.openSubtitlesApiKey, 'User-Agent': config.openSubtitlesUserAgent, Accept: 'application/json' }
  const out = []
  for (const query of openSubtitlesQueries(media)) {
    const data = await requestJson(config.openSubtitlesBaseUrl + '/api/v1/subtitles?' + query, { headers, timeout: 3500 })
    for (const row of Array.isArray(data && data.data) ? data.data : []) {
      const attrs = row && row.attributes || {}
      for (const file of Array.isArray(attrs.files) ? attrs.files : []) {
        const fileId = cleanText(file.file_id, 80)
        const fileName = cleanText(file.file_name || ('opensubtitles-' + fileId + '.srt'), 300)
        addCandidate(out, { provider: 'opensubtitles', providerRef: fileId, language: classifySubtitleLanguage(attrs.language, fileName), fileName, downloadUrl: 'opensubtitles:' + fileId, headers, score: 95 + (attrs.from_trusted ? 15 : 0) }, media)
      }
    }
    if (out.length) break
  }
  return out
}

async function searchSubDL (config, media) {
  if (!config.subdlApiKey) return []
  const headers = { Authorization: 'Bearer ' + config.subdlApiKey, 'X-API-Key': config.subdlApiKey, Accept: 'application/json' }
  const out = []
  const type = media.kind === 'tv' || media.season != null || media.episode != null ? 'tv' : 'movie'
  const attempts = []
  if (/^\d+$/.test(String(media.tmdbId || ''))) attempts.push({ tmdb_id: media.tmdbId, type })
  uniqueStrings([media.originalTitle, media.title, media.aliases], 3).forEach(title => attempts.push({ film_name: title, type }))
  for (const params of attempts) {
    const q = new URLSearchParams({ languages: 'ja,zh', subs_per_page: '30', unpack: '1' })
    Object.entries(params).forEach(([k, v]) => q.set(k, String(v)))
    if (media.season != null) q.set('season', String(media.season))
    if (media.episode != null) q.set('episode', String(media.episode))
    const data = await requestJson(config.subdlBaseUrl + '/api/v2/subtitles/search?' + q, { headers, timeout: 3500 })
    for (const row of Array.isArray(data && data.subtitles) ? data.subtitles : []) {
      const files = Array.isArray(row.unpack_files) && row.unpack_files.length ? row.unpack_files : [row]
      for (const file of files) {
        const fileName = cleanText(file.release_name || file.name || row.release_name || row.name, 300)
        let downloadUrl = cleanText(file.url || row.url, 2048)
        if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) downloadUrl = 'https://dl.subdl.com' + (downloadUrl.startsWith('/') ? '' : '/') + downloadUrl
        addCandidate(out, { provider: 'subdl', providerRef: cleanText(file.file_n_id || file.n_id || row.n_id || crypto.createHash('sha1').update(fileName + downloadUrl).digest('hex'), 300), language: classifySubtitleLanguage(file.language || file.lang || row.language || row.lang, fileName), fileName, downloadUrl, headers: { 'X-API-Key': config.subdlApiKey }, score: 75 }, media)
      }
    }
    if (out.length) break
  }
  return out
}

async function searchAssrt (config, media) {
  if (!config.assrtApiToken) return []
  const headers = { Authorization: 'Bearer ' + config.assrtApiToken, Accept: 'application/json' }
  const out = []
  for (const title of uniqueStrings([media.title, media.originalTitle, media.aliases], 3)) {
    const data = await requestJson(config.assrtBaseUrl + '/v1/sub/search?' + new URLSearchParams({ q: title, cnt: '20' }), { headers, timeout: 2500 })
    const subs = data && data.sub && Array.isArray(data.sub.subs) ? data.sub.subs : []
    for (const row of subs) {
      const id = cleanText(row.id, 80)
      const names = Array.isArray(row.filelist) ? row.filelist.map(x => x && (x.f || x.name)).filter(Boolean) : []
      const list = names.length ? names : [cleanText(row.videoname || row.native_name || ('assrt-' + id + '.ass'), 300)]
      for (const fileName of list) {
        addCandidate(out, { provider: 'assrt', providerRef: id + ':' + fileName, language: classifySubtitleLanguage(row.lang || row.language, fileName), fileName, downloadUrl: 'assrt:' + id, headers, score: 90 + Math.min(20, Number(row.vote_score || row.vote || 0)) }, media)
      }
    }
    if (out.length) break
  }
  return out
}

function candidateToken (candidate) {
  return crypto.createHash('sha256').update(JSON.stringify([candidate.provider, candidate.providerRef, candidate.downloadUrl, candidate.fileName])).digest('hex').slice(0, 32)
}

async function resolveSubtitles (payload = {}) {
  const config = normalizeLocalConfig(payload.config)
  const media = payload.media && typeof payload.media === 'object' ? payload.media : {}
  if (!cleanText(media.title || media.tmdbId)) throw new Error('缺少字幕匹配信息')
  const providers = config.subtitles
  const tasks = [
    ['jimaku', () => searchJimaku(providers, media)],
    ['assrt', () => searchAssrt(providers, media)],
    ['opensubtitles', () => searchOpenSubtitles(providers, media)],
    ['subdl', () => searchSubDL(providers, media)]
  ]
  const settled = await Promise.all(tasks.map(async ([id, fn]) => {
    try { return { id, rows: await fn(), error: '' } } catch (error) { return { id, rows: [], error: cleanText(error && error.message || error, 120) } }
  }))
  const all = []
  settled.forEach(result => all.push(...result.rows))
  all.sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
  const seen = new Set()
  const candidates = []
  for (const row of all) {
    const key = row.provider + '|' + normalizeTitle(row.fileName)
    if (seen.has(key)) continue
    seen.add(key)
    const token = candidateToken(row)
    subtitleCandidateCache.set(token, { ...row, expiresAt: Date.now() + 60 * 60 * 1000 })
    candidates.push({ provider: row.provider, providerRef: row.providerRef, language: row.language, label: row.language === 'ja-zh' ? '日中双语' : '日本語', fileName: row.fileName, score: row.score, fetchUrl: 'local-subtitle://' + token })
    if (candidates.length >= 16) break
  }
  const configured = { jimaku: Boolean(providers.jimakuApiKey), assrt: Boolean(providers.assrtApiToken), opensubtitles: Boolean(providers.openSubtitlesApiKey && providers.openSubtitlesUserAgent), subdl: Boolean(providers.subdlApiKey) }
  return {
    ok: candidates.length > 0,
    candidates,
    autoSelectIndex: candidates.length && Number(candidates[0].score || 0) >= 105 ? 0 : -1,
    identity: { ...media },
    diagnostics: { providers: settled.map(row => ({ id: row.id, configured: configured[row.id], status: row.error ? 'error' : (row.rows.length ? 'ok' : 'no_match'), count: row.rows.length, code: row.error })) }
  }
}

function srtToVtt (text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '')
  return 'WEBVTT\n\n' + normalized.replace(/^\s*\d+\s*$/gm, '').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})\s*-->/g, '$1.$2 -->').replace(/-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '--> $1.$2').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function assToVtt (text) {
  const source = String(text || '').replace(/\r/g, '')
  const lines = ['WEBVTT', '']
  const time = value => {
    const m = String(value || '').trim().match(/(\d+):(\d{2}):(\d{2})[.](\d{2})/)
    return m ? String(m[1]).padStart(2, '0') + ':' + m[2] + ':' + m[3] + '.' + m[4] + '0' : ''
  }
  for (const line of source.split('\n')) {
    if (!/^Dialogue:/i.test(line)) continue
    const parts = line.replace(/^Dialogue:\s*/i, '').split(',')
    if (parts.length < 10) continue
    const start = time(parts[1])
    const end = time(parts[2])
    if (!start || !end) continue
    const body = parts.slice(9).join(',').replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').trim()
    if (body) lines.push(start + ' --> ' + end, body, '')
  }
  return lines.join('\n')
}

function zipEntries (source) {
  const eocdSignature = 0x06054b50
  const centralSignature = 0x02014b50
  const localSignature = 0x04034b50
  const minEocd = 22
  const searchStart = Math.max(0, source.length - 0xffff - minEocd)
  let eocd = -1
  for (let offset = source.length - minEocd; offset >= searchStart; offset--) {
    if (source.readUInt32LE(offset) === eocdSignature) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new Error('字幕 ZIP 结构无效')
  const count = source.readUInt16LE(eocd + 10)
  const centralSize = source.readUInt32LE(eocd + 12)
  const centralOffset = source.readUInt32LE(eocd + 16)
  if (count > 256 || centralOffset + centralSize > source.length) throw new Error('字幕 ZIP 目录异常')

  const rows = []
  let offset = centralOffset
  for (let index = 0; index < count; index++) {
    if (offset + 46 > source.length || source.readUInt32LE(offset) !== centralSignature) throw new Error('字幕 ZIP 目录损坏')
    const method = source.readUInt16LE(offset + 10)
    const compressedSize = source.readUInt32LE(offset + 20)
    const uncompressedSize = source.readUInt32LE(offset + 24)
    const nameLength = source.readUInt16LE(offset + 28)
    const extraLength = source.readUInt16LE(offset + 30)
    const commentLength = source.readUInt16LE(offset + 32)
    const localOffset = source.readUInt32LE(offset + 42)
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength
    if (nextOffset > source.length || uncompressedSize > MAX_SUBTITLE_BYTES || compressedSize > MAX_SUBTITLE_BYTES) {
      offset = nextOffset
      continue
    }
    const name = source.slice(offset + 46, offset + 46 + nameLength).toString('utf8')
    if (!/\.(?:vtt|srt|ass|ssa)$/i.test(name) || /[\\/]$/.test(name)) {
      offset = nextOffset
      continue
    }
    if (localOffset + 30 > source.length || source.readUInt32LE(localOffset) !== localSignature) {
      offset = nextOffset
      continue
    }
    const localNameLength = source.readUInt16LE(localOffset + 26)
    const localExtraLength = source.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > source.length) {
      offset = nextOffset
      continue
    }
    const compressed = source.slice(dataStart, dataEnd)
    let data
    if (method === 0) data = compressed
    else if (method === 8) data = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_SUBTITLE_BYTES })
    else {
      offset = nextOffset
      continue
    }
    if (data.length <= MAX_SUBTITLE_BYTES) rows.push({ name, data })
    offset = nextOffset
  }
  return rows
}

function subtitlePayload (buffer, fileName) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  if (source.length >= 4 && source.readUInt32LE(0) === 0x04034b50) {
    const expected = String(fileName || '').split(/[\\/]/).pop().toLowerCase()
    const entries = zipEntries(source).sort((a, b) => {
      const an = a.name.split(/[\\/]/).pop().toLowerCase()
      const bn = b.name.split(/[\\/]/).pop().toLowerCase()
      const as = an === expected ? 100 : (classifySubtitleLanguage('', an) ? 10 : 0)
      const bs = bn === expected ? 100 : (classifySubtitleLanguage('', bn) ? 10 : 0)
      return bs - as
    })
    if (!entries.length) throw new Error('字幕压缩包没有可用字幕文件')
    return { buffer: entries[0].data, fileName: entries[0].name }
  }
  return { buffer: source, fileName }
}

function toVtt (buffer, fileName, contentType) {
  const payload = subtitlePayload(buffer, fileName)
  const text = payload.buffer.toString('utf8').replace(/^\uFEFF/, '')
  const lower = String(payload.fileName || '').toLowerCase()
  if (text.startsWith('WEBVTT')) return text
  if (lower.endsWith('.ass') || lower.endsWith('.ssa') || /^\[Script Info\]/i.test(text)) return assToVtt(text)
  if (lower.endsWith('.srt') || /\d{2}:\d{2}:\d{2},\d{3}\s*-->/.test(text)) return srtToVtt(text)
  if (String(contentType || '').includes('vtt')) return text
  return text.includes('-->') ? ('WEBVTT\n\n' + text) : ''
}

function detectedSubtitleLanguage (text) {
  const source = String(text || '')
  const japanese = (source.match(/[ぁ-ゖァ-ヺー]/g) || []).length
  const cjk = (source.match(/[\u4e00-\u9fff]/g) || []).length
  if (japanese < 4) return ''
  return cjk >= Math.max(8, japanese / 3) ? 'ja-zh' : 'ja'
}

async function downloadCandidate (candidate, config) {
  if (candidate.provider === 'opensubtitles') {
    const meta = await requestJson(config.subtitles.openSubtitlesBaseUrl + '/api/v1/download', { method: 'POST', body: JSON.stringify({ file_id: Number(candidate.providerRef) }), headers: { ...candidate.headers, 'Content-Type': 'application/json' }, timeout: 3500 })
    if (!meta || !meta.link) throw new Error('OpenSubtitles 未返回下载地址')
    const host = new URL(meta.link).hostname
    return requestBuffer(meta.link, { maxBytes: MAX_SUBTITLE_BYTES, allowedHosts: [host, 'opensubtitles.com'], timeout: 5000 })
  }
  if (candidate.provider === 'assrt') {
    const id = String(candidate.providerRef).split(':')[0]
    const data = await requestJson(config.subtitles.assrtBaseUrl + '/v1/sub/detail?id=' + encodeURIComponent(id), { headers: candidate.headers, timeout: 3000 })
    let downloadUrl = ''
    for (const row of walkObjects(data)) {
      const name = cleanText(row.f || row.name || row.filename, 300)
      const url = cleanText(row.url, 2048)
      if (url && (!candidate.fileName || !name || name === candidate.fileName)) { downloadUrl = url; break }
    }
    if (!downloadUrl) throw new Error('ASSRT 未返回下载地址')
    const host = new URL(downloadUrl).hostname
    return requestBuffer(downloadUrl, { maxBytes: MAX_SUBTITLE_BYTES, allowedHosts: [host, 'assrt.net', 'makedie.me'], timeout: 5000 })
  }
  let downloadUrl = candidate.downloadUrl
  if (candidate.provider === 'subdl' && config.subtitles.subdlApiKey) {
    const url = new URL(downloadUrl)
    url.searchParams.set('api_key', config.subtitles.subdlApiKey)
    downloadUrl = url.toString()
  }
  const host = new URL(downloadUrl).hostname
  let headers = candidate.headers || {}
  if (candidate.provider === 'jimaku') {
    const apiHost = new URL(config.subtitles.jimakuBaseUrl).hostname
    if (host !== apiHost && !host.endsWith('.' + apiHost)) headers = {}
  }
  return requestBuffer(downloadUrl, { headers, maxBytes: MAX_SUBTITLE_BYTES, allowedHosts: [host], timeout: 5000 })
}

async function fetchSubtitle (payload = {}) {
  const config = normalizeLocalConfig(payload.config)
  const raw = cleanText(payload.fetchUrl, 512)
  const match = raw.match(/^local-subtitle:\/\/([a-f0-9]{32})$/)
  if (!match) throw new Error('本地字幕引用无效')
  const candidate = subtitleCandidateCache.get(match[1])
  if (!candidate || candidate.expiresAt <= Date.now()) throw new Error('字幕引用已过期，请重新搜索')
  const response = await downloadCandidate(candidate, config)
  if (response.status < 200 || response.status >= 300) throw new Error('字幕下载 HTTP ' + response.status)
  const vtt = toVtt(response.body, candidate.fileName, response.headers['content-type'])
  if (!vtt || !vtt.includes('-->')) throw new Error('字幕文件没有有效 cue')
  const language = detectedSubtitleLanguage(vtt)
  if (!['ja', 'ja-zh'].includes(language)) throw new Error('字幕内容不是日语/日中双语')
  return { text: vtt, language, contentType: 'text/vtt;charset=UTF-8' }
}

function registerMediaEnhancementIpc (ipcMain) {
  ipcMain.handle('media-enhancement:danmaku-resolve', (event, payload) => resolveDanmaku(payload))
  ipcMain.handle('media-enhancement:subtitle-resolve', (event, payload) => resolveSubtitles(payload))
  ipcMain.handle('media-enhancement:subtitle-fetch', (event, payload) => fetchSubtitle(payload))
}

module.exports = {
  normalizeLocalConfig,
  requestBuffer,
  normalizeDanmakuComments,
  classifySubtitleLanguage,
  srtToVtt,
  assToVtt,
  detectedSubtitleLanguage,
  resolveDanmaku,
  resolveSubtitles,
  fetchSubtitle,
  registerMediaEnhancementIpc
}
