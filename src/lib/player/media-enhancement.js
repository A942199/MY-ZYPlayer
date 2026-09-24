'use strict'

const DEFAULT_CONFIG = Object.freeze({
  baseUrl: 'https://video.zi-quan.com',
  password: '',
  danmakuEnabled: true,
  subtitlesEnabled: false,
  danmaku: {
    opacity: 0.86,
    fontSize: 24,
    speed: 150,
    area: 0.62,
    offset: 0
  }
})

function clamp (value, min, max, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

function normalizeMediaEnhancementConfig (value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const danmaku = source.danmaku && typeof source.danmaku === 'object' ? source.danmaku : {}
  return {
    baseUrl: String(source.baseUrl || DEFAULT_CONFIG.baseUrl).trim() || DEFAULT_CONFIG.baseUrl,
    password: String(source.password || ''),
    danmakuEnabled: source.danmakuEnabled !== false,
    subtitlesEnabled: source.subtitlesEnabled === true,
    danmaku: {
      opacity: clamp(danmaku.opacity, 0.2, 1, DEFAULT_CONFIG.danmaku.opacity),
      fontSize: clamp(danmaku.fontSize, 16, 42, DEFAULT_CONFIG.danmaku.fontSize),
      speed: clamp(danmaku.speed, 80, 280, DEFAULT_CONFIG.danmaku.speed),
      area: clamp(danmaku.area, 0.2, 1, DEFAULT_CONFIG.danmaku.area),
      offset: clamp(danmaku.offset, -120, 120, DEFAULT_CONFIG.danmaku.offset)
    }
  }
}

function intOrNull (value, min, max) {
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
    season = intOrNull(match[1], 0, 200)
    episode = intOrNull(match[2], 0, 10000)
  }
  if (season == null) {
    match = text.match(/(?:^|[^a-z0-9])s(?:eason)?\s*0*(\d{1,3})(?:\D|$)/i) || text.match(/第\s*0*(\d{1,3})\s*季/)
    if (match) season = intOrNull(match[1], 0, 200)
  }
  if (episode == null) {
    match = text.match(/(?:^|[^a-z0-9])e(?:p(?:isode)?)?\s*0*(\d{1,4})(?:\D|$)/i) ||
      text.match(/第\s*0*(\d{1,4})\s*(?:集|話|话)/) ||
      text.match(/(?:^|[^a-z0-9])0*(\d{1,4})\s*(?:集|話|话)(?:\D|$)/i)
    if (match) episode = intOrNull(match[1], 0, 10000)
  }
  return { season, episode }
}

function uniqueStrings (values) {
  const out = []
  const seen = new Set()
  ;(values || []).flat(Infinity).forEach(value => {
    if (value == null) return
    String(value).split(/[|#$，、;；\r\n]+/).forEach(part => {
      const raw = part.trim()
      const key = raw.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
      if (!raw || !key || seen.has(key)) return
      seen.add(key)
      out.push(raw)
    })
  })
  return out.slice(0, 16)
}

function firstYear (value) {
  const match = String(value || '').match(/(?:18|19|20|21)\d{2}/)
  return match ? Number(match[0]) : null
}

function playlistLabel (entry, index) {
  const raw = String(entry || '')
  const parts = raw.split('$')
  return String(parts.length > 1 ? parts[0] : ('第' + (Number(index) + 1) + '集')).trim()
}

function mediaUrlHint (entry) {
  const raw = String(entry || '')
  const parts = raw.split('$')
  const value = parts.length > 1 ? parts.slice(1).join('$') : raw
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').pop() || '').slice(0, 512)
  } catch (error) {
    return value.split('?')[0].split('/').pop().slice(0, 512)
  }
}

function inferKind (detail, videoInfo, playlist) {
  const raw = [
    videoInfo && videoInfo.type,
    detail && detail.type,
    detail && detail.typeName,
    detail && detail.vod_class,
    detail && detail.vod_type
  ].filter(Boolean).join(' ')
  if (/电影|電影|movie|film|剧场版|劇場版/i.test(raw)) return 'movie'
  if (/电视剧|電視劇|连续剧|連續劇|日剧|日劇|美剧|美劇|韩剧|韓劇|番剧|番劇|动漫|動畫|tv|series|show/i.test(raw)) return 'tv'
  return Array.isArray(playlist) && playlist.length > 1 ? 'tv' : ''
}

function buildMediaIdentity ({ videoInfo = {}, detail = {}, playlist = [], selectedEntry = '', name = '' } = {}) {
  const index = Math.max(0, Number(videoInfo.index) || 0)
  const episodeTitle = playlistLabel(selectedEntry || playlist[index], index)
  const title = String(
    detail.title || detail.name || detail.vod_name || videoInfo.name || name || ''
  ).trim()
  const aliases = uniqueStrings([
    detail.aliases,
    detail.alias,
    detail.originalTitle,
    detail.original_title,
    detail.vod_en,
    detail.vod_sub,
    detail.vod_alias
  ])
  const parsedEpisode = parseNumbers(episodeTitle)
  const parsedTitle = parseNumbers(title)
  const kind = inferKind(detail, videoInfo, playlist)
  const season = parsedEpisode.season != null ? parsedEpisode.season : parsedTitle.season
  let episode = parsedEpisode.episode
  if (episode == null && kind === 'tv') episode = index + 1
  const year = intOrNull(videoInfo.year, 1880, 2200) ||
    intOrNull(detail.year, 1880, 2200) ||
    firstYear(detail.vod_year) ||
    firstYear(title)
  const tmdbId = String(detail.tmdbId || detail.tmdb_id || videoInfo.tmdbId || '').replace(/\D/g, '').slice(0, 20)

  const media = {
    title: title.slice(0, 200),
    aliases,
    originalTitle: String(detail.originalTitle || detail.original_title || detail.vod_en || '').trim().slice(0, 200),
    year: year || undefined,
    kind,
    season: season == null ? undefined : season,
    episode: episode == null ? undefined : episode,
    episodeTitle: episodeTitle.slice(0, 200),
    tmdbId,
    releaseHint: mediaUrlHint(selectedEntry || playlist[index])
  }
  Object.keys(media).forEach(key => {
    if (media[key] === '' || media[key] === undefined || media[key] === null) delete media[key]
  })
  return media
}

function normalizeDanmakuComments (data) {
  const raw = Array.isArray(data) ? data : Array.isArray(data && data.comments) ? data.comments : []
  const out = []
  for (const item of raw.slice(0, 16000)) {
    if (!item) continue
    let time = Number(item.time != null ? item.time : item.progress)
    if (time > 100000) time /= 1000
    if (!Number.isFinite(time) || time < 0 || time > 86400) continue
    const text = String(item.text != null ? item.text : item.content != null ? item.content : item.m || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300)
    if (!text) continue
    const modeRaw = item.mode != null ? item.mode : item.type
    const modeNum = Number(modeRaw)
    const mode = modeNum === 5 || String(modeRaw).toLowerCase() === 'top'
      ? 'top'
      : (modeNum === 4 || String(modeRaw).toLowerCase() === 'bottom' ? 'bottom' : 'scroll')
    const color = /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? String(item.color) : '#ffffff'
    out.push({ time: Math.round(time * 1000) / 1000, mode, color, text })
    if (out.length >= 8000) break
  }
  return out.sort((a, b) => a.time - b.time)
}

function allowedSubtitleCandidates (rows) {
  return (Array.isArray(rows) ? rows : []).filter(row => row && row.fetchUrl && (row.language === 'ja' || row.language === 'ja-zh')).slice(0, 16)
}

module.exports = {
  DEFAULT_CONFIG,
  normalizeMediaEnhancementConfig,
  parseNumbers,
  buildMediaIdentity,
  normalizeDanmakuComments,
  allowedSubtitleCandidates,
  playlistLabel
}
