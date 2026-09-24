'use strict'

const http = require('http')
const https = require('https')
const zlib = require('zlib')
const crypto = require('crypto')
const { TextDecoder } = require('util')

const REQUEST_TIMEOUT = 4500
const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024
const SUBTITLE_CACHE_TTL = 30 * 60 * 1000
const DANMAKU_CACHE_TTL = 6 * 60 * 60 * 1000
const TOKEN_TTL = 30 * 60 * 1000
const CACHE_LIMIT = 120
const TOKEN_LIMIT = 240

const subtitleSearchCache = new Map()
const danmakuCache = new Map()
const subtitleTokens = new Map()

function text (value) {
  return String(value == null ? '' : value).trim()
}

function normalizeTitle (value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/[\s._·:：!！?？'"“”‘’()（）[\]【】{}<>《》-]+/g, '')
}

function uniqueStrings (values, limit = 12) {
  const out = []
  const seen = new Set()
  const add = value => {
    if (value == null || out.length >= limit) return
    if (Array.isArray(value)) return value.forEach(add)
    if (typeof value === 'object') return add(value.name || value.title || value.value || '')
    String(value).split(/[|#$，、;；\r\n]+/).forEach(part => {
      const raw = part.trim()
      const key = normalizeTitle(raw)
      if (!raw || !key || seen.has(key) || out.length >= limit) return
      seen.add(key)
      out.push(raw)
    })
  }
  add(values)
  return out
}

function safeLoopbackBase (value) {
  const raw = text(value).replace(/\/+$/, '')
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    if (!loopback || !['http:', 'https:'].includes(url.protocol)) return ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch (error) {
    return ''
  }
}

function normalizeLocalConfig (input = {}) {
  const providers = input.providers && typeof input.providers === 'object' ? input.providers : {}
  const dandanplay = providers.dandanplay && typeof providers.dandanplay === 'object' ? providers.dandanplay : {}
  const jimaku = providers.jimaku && typeof providers.jimaku === 'object' ? providers.jimaku : {}
  const assrt = providers.assrt && typeof providers.assrt === 'object' ? providers.assrt : {}
  const opensubtitles = providers.opensubtitles && typeof providers.opensubtitles === 'object' ? providers.opensubtitles : {}
  const subdl = providers.subdl && typeof providers.subdl === 'object' ? providers.subdl : {}
  const compatibleDanmaku = providers.compatibleDanmaku && typeof providers.compatibleDanmaku === 'object' ? providers.compatibleDanmaku : {}
  return {
    providers: {
      dandanplay: {
        appId: text(dandanplay.appId),
        appSecret: text(dandanplay.appSecret),
        baseUrl: safeLoopbackBase(dandanplay.baseUrl)
      },
      jimaku: {
        apiKey: text(jimaku.apiKey),
        baseUrl: safeLoopbackBase(jimaku.baseUrl)
      },
      assrt: {
        token: text(assrt.token),
        baseUrl: safeLoopbackBase(assrt.baseUrl)
      },
      opensubtitles: {
        apiKey: text(opensubtitles.apiKey),
        userAgent: text(opensubtitles.userAgent) || 'MY-ZYPlayer v2.9',
        baseUrl: safeLoopbackBase(opensubtitles.baseUrl)
      },
      subdl: {
        apiKey: text(subdl.apiKey),
        baseUrl: safeLoopbackBase(subdl.baseUrl)
      },
      compatibleDanmaku: {
        urls: text(compatibleDanmaku.urls),
        token: text(compatibleDanmaku.token)
      }
    }
  }
}

function decodeBody (buffer, encoding) {
  const value = text(encoding).toLowerCase()
  if (value.includes('gzip')) return zlib.gunzipSync(buffer)
  if (value.includes('deflate')) return zlib.inflateSync(buffer)
  if (value.includes('br')) return zlib.brotliDecompressSync(buffer)
  return buffer
}

function requestBuffer (targetUrl, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('provider_redirect_limit'))
    let target
    try {
      target = new URL(targetUrl)
    } catch (error) {
      return reject(new Error('provider_invalid_url'))
    }
    if (!['http:', 'https:'].includes(target.protocol)) return reject(new Error('provider_invalid_protocol'))

    const transport = target.protocol === 'https:' ? https : http
    const body = options.body == null ? null : Buffer.from(options.body)
    const headers = {
      Accept: options.accept || 'application/json,text/plain,*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'User-Agent': 'MY-ZYPlayer/2.9 local-media-runtime',
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
        if (options.allowedHosts && !hostAllowed(next, options.allowedHosts)) {
          res.resume()
          return reject(new Error('provider_forbidden_redirect'))
        }
        res.resume()
        const nextOptions = { ...options }
        if (status === 303) {
          nextOptions.method = 'GET'
          nextOptions.body = null
        }
        requestBuffer(next.href, nextOptions, redirects + 1).then(resolve).catch(reject)
        return
      }

      const chunks = []
      let bytes = 0
      const maxBytes = Number(options.maxBytes) || MAX_JSON_BYTES
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          req.destroy(new Error('provider_response_too_large'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      res.on('end', () => {
        try {
          const decoded = decodeBody(Buffer.concat(chunks), res.headers['content-encoding'])
          if (decoded.length > maxBytes) throw new Error('provider_response_too_large')
          resolve({ status, headers: res.headers, body: decoded, url: target.href })
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(Number(options.timeout) || REQUEST_TIMEOUT, () => req.destroy(new Error('provider_timeout')))
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function requestJson (targetUrl, options = {}) {
  const response = await requestBuffer(targetUrl, {
    ...options,
    accept: 'application/json,text/plain,*/*',
    maxBytes: options.maxBytes || MAX_JSON_BYTES
  })
  let data
  try {
    data = JSON.parse(response.body.toString('utf8') || '{}')
  } catch (error) {
    throw new Error('provider_invalid_json')
  }
  if (response.status < 200 || response.status >= 300) {
    const err = new Error('provider_http_' + response.status)
    err.status = response.status
    err.data = data
    throw err
  }
  return data
}

function hostAllowed (url, allowedHosts) {
  if (!Array.isArray(allowedHosts) || !allowedHosts.length) return true
  const hostname = url.hostname.toLowerCase()
  if (['127.0.0.1', 'localhost', '::1'].includes(hostname)) return true
  return allowedHosts.some(host => hostname === host || hostname.endsWith('.' + host))
}

function providerBase (config, id, fallback) {
  const local = config.providers[id] && config.providers[id].baseUrl
  return local || fallback
}

function cacheGet (cache, key) {
  const row = cache.get(key)
  if (!row || row.expiresAt <= Date.now()) {
    if (row) cache.delete(key)
    return null
  }
  cache.delete(key)
  cache.set(key, row)
  return row.value
}

function cacheSet (cache, key, value, ttl) {
  cache.set(key, { value, expiresAt: Date.now() + ttl })
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
}

function mediaCacheKey (prefix, media, configSignature) {
  return [
    prefix,
    normalizeTitle(media.title),
    Number(media.year || 0),
    text(media.kind).toLowerCase(),
    Number(media.season || 0),
    Number(media.episode || 0),
    text(media.tmdbId),
    configSignature
  ].join('|')
}

function classifySubtitleMetadata (value, fileName) {
  const raw = text(value)
  const v = raw.toLowerCase()
  const name = text(fileName)
  const s = v + ' ' + name.toLowerCase()
  const hasJa = /^(?:ja|jpn|japanese)$|\bjapanese\b|日本語/.test(v) || /(?:^|[^a-z0-9])(?:jpn|ja)(?=$|[^a-z0-9])|日本語/i.test(name)
  const hasZh = /^(?:zh|zh-cn|zh-tw|zho|chi|chinese|ze)$|\bchinese\b|中文|zh[-_]?(?:hans|hant)/.test(v) || /(?:^|[^a-z0-9])(?:chs|cht|zh|chi|zho)(?=$|[^a-z0-9])|中文|简体|簡體|繁體|繁体/i.test(name)
  const hasEn = /^(?:en|eng|english)$|\benglish\b|英语|英文/.test(v) || /(?:^|[^a-z0-9])(?:eng|en)(?=$|[^a-z0-9])|英语|英文/i.test(name)
  if (hasJa && hasZh && !hasEn) return 'ja-zh'
  if (hasJa && hasEn) return 'ja-en'
  if (hasJa) return 'ja'
  if (/繁/.test(s)) return 'zh-TW'
  if (hasZh) return 'zh-CN'
  if (hasEn) return 'en'
  return 'und'
}

function classifySubtitleContent (src) {
  const sample = text(src).slice(0, 48000)
  const blocks = sample.split(/\n\s*\n/).slice(0, 400)
  let ja = 0
  let zh = 0
  let en = 0
  let bilingual = 0
  for (const block of blocks) {
    let hasJa = false
    let hasZh = false
    for (const line of block.split(/\r?\n/)) {
      const clean = line.replace(/<[^>]+>|\{[^}]+\}|\d{1,2}:\d{2}:\d{2}[.,:]\d+/g, ' ')
      const kana = (clean.match(/[ぁ-ゖァ-ヺ]/g) || []).length
      const cjk = (clean.match(/[\u3400-\u9fff]/g) || []).length
      const latin = (clean.match(/[A-Za-z]/g) || []).length
      if (kana >= 2) {
        ja++
        hasJa = true
      } else if (cjk >= 2 && latin < Math.max(8, cjk * 2)) {
        zh++
        hasZh = true
      } else if (latin >= 8 && cjk < 3) en++
    }
    if (hasJa && hasZh) bilingual++
  }
  const significantEnglish = en >= Math.max(3, Math.ceil(ja * 0.5))
  if (ja >= 3 && zh >= 3 && bilingual >= 2 && !significantEnglish) return 'ja-zh'
  if (ja >= 2 && significantEnglish) return 'ja-en'
  if (ja >= 2) return 'ja'
  if (zh >= 3 && ja === 0) return 'zh-CN'
  if (en >= 3 && ja === 0 && zh < 2) return 'en'
  return 'und'
}

function isAllowedSubtitleLanguage (value) {
  return value === 'ja' || value === 'ja-zh'
}

function subtitleLabel (language) {
  return language === 'ja-zh' ? '日中双语' : '日本語'
}

function parseNumbers (value) {
  const source = text(value).normalize('NFKC')
  let season = null
  let episode = null
  let match = source.match(/s(?:eason)?\s*0*(\d{1,3})\s*[-_. ]*e(?:p(?:isode)?)?\s*0*(\d{1,4})/i)
  if (match) {
    season = Number(match[1])
    episode = Number(match[2])
  }
  if (episode == null) {
    match = source.match(/第\s*0*(\d{1,4})\s*(?:集|話|话)/) || source.match(/\be(?:p(?:isode)?)?\s*0*(\d{1,4})\b/i)
    if (match) episode = Number(match[1])
  }
  if (season == null) {
    match = source.match(/第\s*0*(\d{1,3})\s*季/) || source.match(/\bs(?:eason)?\s*0*(\d{1,3})\b/i)
    if (match) season = Number(match[1])
  }
  return { season, episode }
}

function mediaTitles (media) {
  return uniqueStrings([media.originalTitle, media.englishTitle, media.title, media.aliases], 8)
}

function candidateCompatible (candidate, media) {
  const numbers = parseNumbers(candidate.fileName)
  if (media.season != null && numbers.season != null && Number(media.season) !== numbers.season) return false
  if (media.episode != null && numbers.episode != null && Number(media.episode) !== numbers.episode) return false
  return true
}

function candidateScore (candidate, media) {
  let score = Number(candidate.score || 0)
  if (candidate.language === 'ja-zh') score += 12
  if (candidate.language === 'ja') score += 6
  const release = normalizeTitle(media.releaseHint)
  const file = normalizeTitle(candidate.fileName)
  if (release && file && (release.includes(file) || file.includes(release))) score += 12
  const numbers = parseNumbers(candidate.fileName)
  if (media.episode != null && numbers.episode === Number(media.episode)) score += 18
  if (media.season != null && numbers.season === Number(media.season)) score += 10
  return score
}

function addSubtitleToken (candidate) {
  const token = crypto.randomBytes(12).toString('hex')
  subtitleTokens.set(token, { candidate, expiresAt: Date.now() + TOKEN_TTL })
  while (subtitleTokens.size > TOKEN_LIMIT) subtitleTokens.delete(subtitleTokens.keys().next().value)
  return token
}

function getSubtitleToken (fetchUrl) {
  const match = /^local-subtitle:\/\/([a-f0-9]{24})$/i.exec(text(fetchUrl))
  if (!match) throw new Error('subtitle_reference_invalid')
  const row = subtitleTokens.get(match[1])
  if (!row || row.expiresAt <= Date.now()) {
    if (row) subtitleTokens.delete(match[1])
    throw new Error('subtitle_reference_expired')
  }
  return row.candidate
}

function publicCandidate (candidate) {
  const token = addSubtitleToken(candidate)
  return {
    provider: candidate.provider,
    providerRef: candidate.providerRef,
    language: candidate.language,
    label: subtitleLabel(candidate.language),
    fileName: candidate.fileName,
    score: candidate.score,
    fetchUrl: 'local-subtitle://' + token
  }
}

async function jimakuSearch (config, media) {
  const provider = config.providers.jimaku
  if (!provider.apiKey) return []
  const base = providerBase(config, 'jimaku', 'https://jimaku.cc')
  const headers = { Authorization: provider.apiKey, Accept: 'application/json' }
  const queries = []
  const tmdbId = text(media.tmdbId).replace(/\D/g, '')
  const kind = text(media.kind).toLowerCase()
  if (tmdbId && (kind === 'movie' || kind === 'tv')) {
    queries.push(new URLSearchParams({ tmdb_id: kind + ':' + tmdbId, anime: 'false' }))
    queries.push(new URLSearchParams({ tmdb_id: kind + ':' + tmdbId, anime: 'true' }))
  }
  mediaTitles(media).slice(0, 4).forEach(name => {
    if (/[ぁ-んァ-ヶA-Za-z]/.test(name)) queries.push(new URLSearchParams({ query: name, anime: String(!['movie', 'tv'].includes(kind)) }))
  })
  const entries = new Map()
  for (const query of queries.slice(0, 6)) {
    const data = await requestJson(base + '/api/entries/search?' + query.toString(), { headers, timeout: 3500 }).catch(() => [])
    for (const entry of Array.isArray(data) ? data : []) {
      const id = text(entry.id)
      if (!id) continue
      let score = 0
      const entryTmdb = text(entry.tmdb_id).toLowerCase()
      if (tmdbId && entryTmdb === kind + ':' + tmdbId) score += 1000
      for (const wanted of mediaTitles(media)) {
        const w = normalizeTitle(wanted)
        for (const value of [entry.japanese_name, entry.english_name, entry.name]) {
          const c = normalizeTitle(value)
          if (!w || !c) continue
          if (w === c) score = Math.max(score, 220)
          else if (w.includes(c) || c.includes(w)) score = Math.max(score, 100)
        }
      }
      const old = entries.get(id)
      if (!old || score > old.score) entries.set(id, { entry, score })
    }
  }

  const ranked = Array.from(entries.values()).sort((a, b) => b.score - a.score).slice(0, 2)
  const out = []
  for (const row of ranked) {
    if (row.score < 80) continue
    const url = new URL(base + '/api/entries/' + encodeURIComponent(text(row.entry.id)) + '/files')
    if (text(media.kind).toLowerCase() === 'tv' && media.episode != null) url.searchParams.set('episode', String(media.episode))
    const files = await requestJson(url.toString(), { headers, timeout: 3500 }).catch(() => [])
    for (const file of Array.isArray(files) ? files : []) {
      const fileName = text(file.name)
      const downloadUrl = text(file.url)
      if (!downloadUrl || !/\.(srt|ass|ssa|vtt)(?:$|\?)/i.test(fileName)) continue
      let language = classifySubtitleMetadata('', fileName)
      if (language === 'und') language = 'ja'
      const candidate = {
        provider: 'jimaku',
        providerRef: text(row.entry.id) + ':' + fileName,
        fileName,
        language,
        downloadUrl,
        score: row.score >= 1000 ? 130 : 105,
        headers: { Authorization: provider.apiKey },
        allowedHosts: provider.baseUrl ? ['127.0.0.1', 'localhost'] : ['jimaku.cc']
      }
      if (isAllowedSubtitleLanguage(language) && candidateCompatible(candidate, media)) out.push(candidate)
    }
  }
  return out
}

function openSubtitlesQueries (media) {
  const queries = []
  const common = { languages: 'ja,zh-cn,zh-tw' }
  const kind = text(media.kind).toLowerCase()
  const tmdbId = text(media.tmdbId).replace(/\D/g, '')
  if (tmdbId) {
    if (kind === 'tv' || media.episode != null) {
      const p = { ...common, parent_tmdb_id: tmdbId, type: 'episode' }
      if (media.season != null) p.season_number = String(media.season)
      if (media.episode != null) p.episode_number = String(media.episode)
      queries.push(new URLSearchParams(p))
    } else {
      queries.push(new URLSearchParams({ ...common, tmdb_id: tmdbId, type: 'movie' }))
    }
  }
  for (const title of mediaTitles(media).slice(0, 2)) {
    const p = { ...common, query: title, type: kind === 'tv' || media.episode != null ? 'episode' : 'movie' }
    if (media.season != null) p.season_number = String(media.season)
    if (media.episode != null) p.episode_number = String(media.episode)
    queries.push(new URLSearchParams(p))
  }
  return queries.slice(0, 3)
}

async function openSubtitlesSearch (config, media) {
  const provider = config.providers.opensubtitles
  if (!provider.apiKey || !provider.userAgent) return []
  const base = providerBase(config, 'opensubtitles', 'https://api.opensubtitles.com')
  const headers = { 'Api-Key': provider.apiKey, 'User-Agent': provider.userAgent, Accept: 'application/json' }
  const out = []
  for (const query of openSubtitlesQueries(media)) {
    const data = await requestJson(base + '/api/v1/subtitles?' + query.toString(), { headers, timeout: 3500 }).catch(() => null)
    for (const row of data && Array.isArray(data.data) ? data.data : []) {
      const attrs = row && row.attributes ? row.attributes : {}
      const files = Array.isArray(attrs.files) ? attrs.files : []
      for (const file of files) {
        const id = text(file.file_id)
        if (!/^\d+$/.test(id)) continue
        const fileName = text(file.file_name) || ('opensubtitles-' + id + '.srt')
        const language = classifySubtitleMetadata(attrs.language, fileName)
        const candidate = {
          provider: 'opensubtitles',
          providerRef: id,
          fileName,
          language,
          downloadUrl: base + '/api/v1/download',
          score: 95 + Math.min(18, Math.floor(Math.log10(Math.max(1, Number(attrs.download_count || 0))) * 6)),
          fileId: Number(id),
          headers,
          allowedHosts: provider.baseUrl ? ['127.0.0.1', 'localhost'] : ['opensubtitles.com']
        }
        if (isAllowedSubtitleLanguage(language) && candidateCompatible(candidate, media)) out.push(candidate)
      }
    }
    if (out.length) break
  }
  return out
}

function assrtLanguage (row, fileName) {
  const desc = text(row && row.lang && row.lang.desc)
  const combined = desc + ' ' + fileName
  if (/(?:日.*(?:中|简|簡|繁)|(?:中|简|簡|繁).*日)/.test(combined)) return 'ja-zh'
  if (/日/.test(combined)) return 'ja'
  return classifySubtitleMetadata(desc, fileName)
}

async function assrtSearch (config, media) {
  const provider = config.providers.assrt
  if (!provider.token) return []
  const base = providerBase(config, 'assrt', 'https://api.assrt.net')
  const headers = { Authorization: 'Bearer ' + provider.token, Accept: 'application/json' }
  const out = []
  const episodeTag = media.episode != null ? (media.season != null ? ' S' + String(media.season).padStart(2, '0') : '') + 'E' + String(media.episode).padStart(2, '0') : ''
  for (const title of mediaTitles(media).slice(0, 3)) {
    const query = new URLSearchParams({ q: title + episodeTag, cnt: '15', pos: '0', filelist: '1' })
    const data = await requestJson(base + '/v1/sub/search?' + query.toString(), { headers, timeout: 2500 }).catch(() => null)
    const rows = data && Number(data.status) === 0 && data.sub && Array.isArray(data.sub.subs) ? data.sub.subs : []
    for (const row of rows) {
      const id = text(row.id)
      if (!id) continue
      const listed = (Array.isArray(row.filelist) ? row.filelist : []).map(file => text(file && (file.f || file.name))).filter(Boolean)
      const names = listed.length ? listed : [text(row.videoname || row.native_name || ('assrt-' + id + '.srt'))]
      for (const fileName of names) {
        if (!/\.(srt|ass|ssa|vtt)$/i.test(fileName)) continue
        const language = assrtLanguage(row, fileName)
        const candidate = {
          provider: 'assrt',
          providerRef: id + ':' + fileName,
          fileName,
          language,
          score: 100 + Math.max(0, Math.min(20, Math.round(Number(row.vote_score || 0) / 5))),
          detailId: id,
          headers,
          baseUrl: base,
          allowedHosts: provider.baseUrl ? ['127.0.0.1', 'localhost'] : ['assrt.net', 'makedie.me']
        }
        if (isAllowedSubtitleLanguage(language) && candidateCompatible(candidate, media)) out.push(candidate)
      }
    }
    if (out.length) break
  }
  return out
}

async function subdlSearch (config, media) {
  const provider = config.providers.subdl
  if (!provider.apiKey) return []
  const base = providerBase(config, 'subdl', 'https://api.subdl.com')
  const headers = { Authorization: 'Bearer ' + provider.apiKey, 'X-API-Key': provider.apiKey, Accept: 'application/json' }
  const out = []
  const kind = text(media.kind).toLowerCase() === 'tv' || media.episode != null ? 'tv' : 'movie'
  for (const title of mediaTitles(media).slice(0, 3)) {
    const params = { languages: 'ja,zh', subs_per_page: '30', unpack: '1', film_name: title, type: kind }
    if (media.year) params.year = String(media.year)
    if (media.season != null) params.season = String(media.season)
    if (media.episode != null) params.episode = String(media.episode)
    const query = new URLSearchParams(params)
    const data = await requestJson(base + '/api/v2/subtitles/search?' + query.toString(), { headers, timeout: 3500 }).catch(() => null)
    const rows = data && Array.isArray(data.subtitles) ? data.subtitles : []
    for (const row of rows) {
      const files = Array.isArray(row.unpack_files) && row.unpack_files.length ? row.unpack_files : [row]
      for (const file of files) {
        const fileName = text(file.release_name || file.name || row.release_name || row.name)
        let downloadUrl = text(file.url || row.url)
        if (!downloadUrl) continue
        if (!/^https?:\/\//i.test(downloadUrl)) downloadUrl = 'https://dl.subdl.com/' + downloadUrl.replace(/^\/+/, '')
        const language = classifySubtitleMetadata(file.language || file.lang || row.language || row.lang, fileName)
        const candidate = {
          provider: 'subdl',
          providerRef: text(file.file_n_id || file.n_id || row.n_id || fileName),
          fileName: fileName || 'subdl.srt',
          language,
          downloadUrl,
          score: 85 + Math.round(Number(row.match_score || file.match_score || 0) * 20),
          headers: { 'X-API-Key': provider.apiKey },
          apiKey: provider.apiKey,
          allowedHosts: provider.baseUrl ? ['127.0.0.1', 'localhost'] : ['subdl.com', 'dl.subdl.com']
        }
        if (isAllowedSubtitleLanguage(language) && candidateCompatible(candidate, media)) out.push(candidate)
      }
    }
    if (out.length) break
  }
  return out
}

function subtitleConfigSignature (config) {
  return crypto.createHash('sha1').update(JSON.stringify({
    j: !!config.providers.jimaku.apiKey,
    a: !!config.providers.assrt.token,
    o: !!config.providers.opensubtitles.apiKey,
    s: !!config.providers.subdl.apiKey,
    jb: config.providers.jimaku.baseUrl,
    ab: config.providers.assrt.baseUrl,
    ob: config.providers.opensubtitles.baseUrl,
    sb: config.providers.subdl.baseUrl
  })).digest('hex').slice(0, 12)
}

async function resolveSubtitles (payload = {}) {
  const config = normalizeLocalConfig(payload.config)
  const media = payload.media && typeof payload.media === 'object' ? payload.media : {}
  if (!text(media.title || media.tmdbId)) throw new Error('缺少字幕匹配信息')
  const key = mediaCacheKey('subtitle', media, subtitleConfigSignature(config))
  if (!payload.force) {
    const cached = cacheGet(subtitleSearchCache, key)
    if (cached) return cached
  }

  const jobs = [
    ['jimaku', jimakuSearch(config, media)],
    ['assrt', assrtSearch(config, media)],
    ['opensubtitles', openSubtitlesSearch(config, media)],
    ['subdl', subdlSearch(config, media)]
  ]
  const settled = await Promise.all(jobs.map(async ([id, promise]) => {
    try {
      return { id, rows: await promise, error: '' }
    } catch (error) {
      return { id, rows: [], error: text(error && error.message || error) }
    }
  }))
  const merged = []
  for (const result of settled) merged.push(...result.rows)
  const seen = new Set()
  const rows = merged
    .filter(candidate => {
      const key = candidate.provider + '|' + candidate.providerRef
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(candidate => ({ ...candidate, score: candidateScore(candidate, media) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)

  const publicRows = rows.map(publicCandidate)
  const configured = {
    jimaku: !!config.providers.jimaku.apiKey,
    assrt: !!config.providers.assrt.token,
    opensubtitles: !!config.providers.opensubtitles.apiKey,
    subdl: !!config.providers.subdl.apiKey
  }
  const result = {
    ok: publicRows.length > 0,
    local: true,
    candidates: publicRows,
    autoSelectIndex: publicRows.length ? 0 : -1,
    diagnostics: {
      providers: settled.map(row => ({
        id: row.id,
        configured: configured[row.id],
        count: row.rows.length,
        status: row.error ? 'error' : (row.rows.length ? 'ok' : (configured[row.id] ? 'no_match' : 'unconfigured')),
        code: row.error
      }))
    }
  }
  cacheSet(subtitleSearchCache, key, result, SUBTITLE_CACHE_TTL)
  return result
}

function decodeWith (buffer, charset, fatal) {
  return new TextDecoder(charset, { fatal: !!fatal, ignoreBOM: false }).decode(buffer)
}

function decodeSubtitle (buffer, contentType, language) {
  const bytes = new Uint8Array(buffer)
  const match = /charset=([^;]+)/i.exec(contentType || '')
  const explicit = match ? match[1].trim().replace(/["']/g, '') : ''
  if (explicit) {
    try { return decodeWith(bytes, explicit, false) } catch (error) {}
  }
  try { return decodeWith(bytes, 'utf-8', true) } catch (error) {}
  const charsets = String(language || '').startsWith('ja')
    ? ['shift_jis', 'gb18030', 'big5', 'windows-1252']
    : ['gb18030', 'big5', 'shift_jis', 'windows-1252']
  for (const charset of charsets) {
    try { return decodeWith(bytes, charset, false) } catch (error) {}
  }
  return Buffer.from(buffer).toString('utf8')
}

function vttTime (value) {
  const raw = text(value).replace(',', '.')
  const parts = raw.split(':')
  if (parts.length !== 2 && parts.length !== 3) return raw
  const sec = parts[parts.length - 1]
  const dot = sec.indexOf('.')
  const whole = dot >= 0 ? sec.slice(0, dot) : sec
  const frac = (dot >= 0 ? sec.slice(dot + 1) : '').padEnd(3, '0').slice(0, 3)
  const prefix = parts.length === 2 ? ['00', parts[0].padStart(2, '0')] : [parts[0].padStart(2, '0'), parts[1].padStart(2, '0')]
  return prefix.join(':') + ':' + whole.padStart(2, '0') + '.' + frac
}

function srtToVtt (src) {
  return 'WEBVTT\n\n' + src.replace(/^\uFEFF/, '').replace(/\r/g, '').replace(/(\d{1,2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{3})/g, '$1.$2 --> $3.$4')
}

function splitAssFields (body, count) {
  const out = []
  let rest = body
  for (let index = 0; index < count - 1; index++) {
    const at = rest.indexOf(',')
    if (at < 0) return []
    out.push(rest.slice(0, at))
    rest = rest.slice(at + 1)
  }
  out.push(rest)
  return out
}

function assToVtt (src) {
  const lines = src.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')
  const out = ['WEBVTT', '']
  let inEvents = false
  let format = []
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (section) {
      inEvents = section[1].trim().toLowerCase() === 'events'
      continue
    }
    if (inEvents && /^\s*Format\s*:/i.test(line)) {
      format = line.replace(/^\s*Format\s*:\s*/i, '').split(',').map(value => value.trim().toLowerCase())
      continue
    }
    if (!/^\s*Dialogue\s*:/i.test(line)) continue
    const body = line.replace(/^\s*Dialogue\s*:\s*/i, '')
    const parts = format.length ? splitAssFields(body, format.length) : splitAssFields(body, 10)
    if (!parts.length) continue
    const startIndex = format.length ? format.indexOf('start') : 1
    const endIndex = format.length ? format.indexOf('end') : 2
    const textIndex = format.length ? format.indexOf('text') : 9
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) continue
    const cue = text(parts[textIndex]).replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim()
    if (!cue) continue
    out.push(vttTime(parts[startIndex]) + ' --> ' + vttTime(parts[endIndex]), cue, '')
  }
  return out.join('\n')
}

async function fetchDirectSubtitle (candidate) {
  const headers = { ...(candidate.headers || {}), Accept: 'text/plain,text/vtt,application/octet-stream;q=0.9,*/*;q=0.8' }
  let target = candidate.downloadUrl

  if (candidate.provider === 'opensubtitles') {
    const metadata = await requestJson(target, {
      method: 'POST',
      body: JSON.stringify({ file_id: candidate.fileId }),
      headers: { ...candidate.headers, 'Content-Type': 'application/json' },
      timeout: 4500
    })
    target = text(metadata.link)
    if (!target) throw new Error('opensubtitles_download_missing_link')
  } else if (candidate.provider === 'assrt') {
    const data = await requestJson(candidate.baseUrl + '/v1/sub/detail?id=' + encodeURIComponent(candidate.detailId), {
      headers: candidate.headers,
      timeout: 3000
    })
    const rows = data && Number(data.status) === 0 && data.sub && Array.isArray(data.sub.subs) ? data.sub.subs : []
    const row = rows[0] || {}
    const files = Array.isArray(row.filelist) ? row.filelist : []
    const wanted = candidate.fileName
    const file = files.find(item => text(item && (item.f || item.name)) === wanted) || files.find(item => text(item && item.url))
    target = text(file && file.url || row.url)
    if (!target) throw new Error('assrt_download_missing_link')
  } else if (candidate.provider === 'subdl') {
    const url = new URL(target)
    if (candidate.apiKey && !url.searchParams.has('api_key')) url.searchParams.set('api_key', candidate.apiKey)
    target = url.toString()
  }

  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch (error) {
    throw new Error('subtitle_download_invalid_url')
  }
  if (!hostAllowed(targetUrl, candidate.allowedHosts)) throw new Error('subtitle_download_forbidden_host')

  const response = await requestBuffer(targetUrl.toString(), {
    headers,
    maxBytes: MAX_SUBTITLE_BYTES,
    timeout: 7000,
    allowedHosts: candidate.allowedHosts,
    accept: 'text/plain,text/vtt,application/octet-stream;q=0.9,*/*;q=0.8'
  })
  if (response.status < 200 || response.status >= 300) throw new Error('subtitle_download_http_' + response.status)

  const contentType = text(response.headers['content-type'])
  const src = decodeSubtitle(response.body, contentType, candidate.language)
  const lower = (new URL(response.url).pathname + ' ' + candidate.fileName).toLowerCase()
  const converted = lower.includes('.vtt') || contentType.includes('text/vtt')
    ? src
    : (/\.(ass|ssa)(?:\s|$)/i.test(lower) || /^\s*\[Script Info\]/i.test(src) ? assToVtt(src) : srtToVtt(src))
  if (!converted.includes('-->')) throw new Error('subtitle_convert_empty')

  const detected = classifySubtitleContent(src)
  const finalLanguage = isAllowedSubtitleLanguage(detected)
    ? detected
    : (detected === 'und' && isAllowedSubtitleLanguage(candidate.language) ? candidate.language : '')
  if (!finalLanguage) throw new Error('subtitle_language_not_allowed')
  return {
    text: converted,
    language: finalLanguage,
    contentType: 'text/vtt;charset=utf-8'
  }
}

async function fetchSubtitle (payload = {}) {
  normalizeLocalConfig(payload.config)
  const candidate = getSubtitleToken(payload.fetchUrl)
  return await fetchDirectSubtitle(candidate)
}

function normalizeDanmakuComments (data) {
  let raw = []
  if (Array.isArray(data)) raw = data
  else if (data && Array.isArray(data.comments)) raw = data.comments
  else if (data && Array.isArray(data.comment)) raw = data.comment
  else if (data && Array.isArray(data.list)) raw = data.list
  else if (data && Array.isArray(data.data)) raw = data.data
  const out = []
  for (const item of raw.slice(0, 16000)) {
    if (!item) continue
    let time = Number(item.time != null ? item.time : (item.progress != null ? item.progress : item.timestamp))
    let mode = item.mode != null ? item.mode : item.type
    let color = item.color
    if (typeof item.p === 'string') {
      const parts = item.p.split(',')
      time = Number(parts[0] || time)
      mode = parts[1] || mode
      color = parts[2] || color
    }
    if (time > 100000) time /= 1000
    if (!Number.isFinite(time) || time < 0 || time > 86400) continue
    const value = text(item.m != null ? item.m : (item.text != null ? item.text : item.content)).replace(/[\r\n\t]+/g, ' ').slice(0, 300)
    if (!value) continue
    out.push({ time, mode, color, text: value })
    if (out.length >= 8000) break
  }
  return out
}

function danmakuTitleScore (media, candidate) {
  const wanted = mediaTitles(media).map(normalizeTitle).filter(Boolean)
  const current = normalizeTitle(candidate)
  if (!current) return 0
  let score = 0
  for (const title of wanted) {
    if (title === current) score = Math.max(score, 120)
    else if (title.includes(current) || current.includes(title)) score = Math.max(score, 80)
  }
  return score
}

function collectObjects (value, out = [], depth = 0) {
  if (depth > 5 || value == null) return out
  if (Array.isArray(value)) {
    value.slice(0, 400).forEach(item => collectObjects(item, out, depth + 1))
    return out
  }
  if (typeof value !== 'object') return out
  out.push(value)
  Object.values(value).forEach(child => {
    if (Array.isArray(child) || (child && typeof child === 'object')) collectObjects(child, out, depth + 1)
  })
  return out
}

function firstText (obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] != null && text(obj[key])) return text(obj[key])
  }
  return ''
}

function episodeNumber (obj) {
  for (const key of ['episode', 'episodeNumber', 'episodeNo']) {
    const value = Number(obj && obj[key])
    if (Number.isFinite(value)) return value
  }
  return parseNumbers(firstText(obj, ['episodeTitle', 'episode_title', 'subtitle', 'name', 'title'])).episode
}

function normalizeEpisodeMatches (data, provider, media) {
  const out = []
  const seen = new Set()
  const push = (episode, parent) => {
    const episodeId = firstText(episode, ['episodeId', 'episode_id', 'commentId', 'comment_id'])
    if (!episodeId || seen.has(episodeId)) return
    const animeTitle = firstText(episode, ['animeTitle', 'anime_title', 'bangumiTitle', 'seriesTitle']) || firstText(parent, ['animeTitle', 'anime_title', 'bangumiTitle', 'seriesTitle', 'title', 'name'])
    const ep = episodeNumber(episode)
    if (media.episode != null && ep != null && Number(media.episode) !== ep) return
    const score = danmakuTitleScore(media, animeTitle) + (media.episode != null && ep === Number(media.episode) ? 30 : 0)
    if (score < 70) return
    seen.add(episodeId)
    out.push({ provider, episodeId, animeTitle, episodeTitle: firstText(episode, ['episodeTitle', 'episode_title', 'subtitle', 'name']), score })
  }

  for (const parent of collectObjects(data)) {
    const episodes = Array.isArray(parent.episodes) ? parent.episodes : (Array.isArray(parent.episodeList) ? parent.episodeList : [])
    episodes.slice(0, 500).forEach(episode => push(episode, parent))
  }
  for (const obj of collectObjects(data)) push(obj, {})
  return out.sort((a, b) => b.score - a.score)
}

function compatibleDanmakuProviders (config) {
  const out = []
  const dandan = config.providers.dandanplay
  if (dandan.appId && dandan.appSecret) {
    out.push({
      id: 'dandanplay',
      name: '弹弹play',
      baseUrl: providerBase(config, 'dandanplay', 'https://api.dandanplay.net'),
      headers: { 'X-AppId': dandan.appId, 'X-AppSecret': dandan.appSecret }
    })
  }
  const urls = uniqueStrings(text(config.providers.compatibleDanmaku.urls).split(/[\r\n,;]+/), 8)
  urls.forEach((baseUrl, index) => {
    try {
      const url = new URL(baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return
      out.push({
        id: 'compatible-' + index,
        name: '兼容弹幕源 ' + (index + 1),
        baseUrl: baseUrl.replace(/\/+$/, ''),
        headers: config.providers.compatibleDanmaku.token ? { Authorization: 'Bearer ' + config.providers.compatibleDanmaku.token } : {}
      })
    } catch (error) {}
  })
  return out
}

async function danmakuProviderJson (provider, path, params) {
  const url = new URL(path.replace(/^\/+/, ''), provider.baseUrl.replace(/\/+$/, '') + '/')
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value))
  })
  return await requestJson(url.toString(), { headers: provider.headers, timeout: 3200, maxBytes: 2 * 1024 * 1024 })
}

async function findDanmakuMatch (provider, media) {
  for (const title of mediaTitles(media).slice(0, 3)) {
    const data = await danmakuProviderJson(provider, '/api/v2/search/episodes', {
      anime: title,
      episode: media.episode,
      tmdbId: media.tmdbId,
      v2: 'true'
    }).catch(() => null)
    const match = normalizeEpisodeMatches(data, provider.id, media)[0]
    if (match) return match
  }
  return null
}

function danmakuConfigSignature (config) {
  return crypto.createHash('sha1').update(JSON.stringify({
    d: !!config.providers.dandanplay.appId,
    db: config.providers.dandanplay.baseUrl,
    c: config.providers.compatibleDanmaku.urls
  })).digest('hex').slice(0, 12)
}

async function resolveDanmaku (payload = {}) {
  const config = normalizeLocalConfig(payload.config)
  const media = payload.media && typeof payload.media === 'object' ? payload.media : {}
  if (!text(media.title)) throw new Error('缺少弹幕匹配标题')
  const providers = compatibleDanmakuProviders(config)
  if (!providers.length) {
    return { enabled: false, matched: false, local: true, providerCount: 0, comments: [] }
  }

  const key = mediaCacheKey('danmaku', media, danmakuConfigSignature(config))
  if (!payload.force) {
    const cached = cacheGet(danmakuCache, key)
    if (cached) return { ...cached, cached: true }
  }

  const settled = await Promise.all(providers.map(async provider => {
    try {
      return { provider, match: await findDanmakuMatch(provider, media), error: '' }
    } catch (error) {
      return { provider, match: null, error: text(error && error.message || error) }
    }
  }))
  const matches = settled.filter(row => row.match).sort((a, b) => b.match.score - a.match.score)
  for (const row of matches) {
    try {
      const data = await danmakuProviderJson(row.provider, '/api/v2/comment/' + encodeURIComponent(row.match.episodeId), {
        withRelated: 'true',
        chConvert: 1
      })
      const comments = normalizeDanmakuComments(data)
      if (!comments.length) continue
      const result = {
        enabled: true,
        matched: true,
        local: true,
        provider: row.provider.id,
        providerName: row.provider.name,
        episodeId: row.match.episodeId,
        comments,
        attemptedProviders: settled.map(item => item.provider.id)
      }
      cacheSet(danmakuCache, key, result, DANMAKU_CACHE_TTL)
      return result
    } catch (error) {}
  }

  return {
    enabled: true,
    matched: false,
    local: true,
    providerCount: providers.length,
    attemptedProviders: settled.map(item => item.provider.id),
    errors: settled.filter(item => item.error).map(item => ({ provider: item.provider.id, code: item.error })),
    comments: []
  }
}

function registerMediaEnhancementIpc (ipcMain) {
  ipcMain.handle('media-enhancement:danmaku-resolve', (event, payload) => resolveDanmaku(payload))
  ipcMain.handle('media-enhancement:subtitle-resolve', (event, payload) => resolveSubtitles(payload))
  ipcMain.handle('media-enhancement:subtitle-fetch', (event, payload) => fetchSubtitle(payload))
}

module.exports = {
  normalizeLocalConfig,
  requestBuffer,
  classifySubtitleMetadata,
  classifySubtitleContent,
  resolveDanmaku,
  resolveSubtitles,
  fetchSubtitle,
  registerMediaEnhancementIpc
}
