'use strict'

const MATCH_THRESHOLD = 85
const GENERIC_EPISODE_LABELS = new Set([
  '',
  '立即播放',
  '正片',
  '播放',
  'play',
  'watch',
  'watchnow'
])


function normalizeTitle (value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/第\s*\d+\s*季|season\s*\d+/gi, '')
    .replace(/[\s·•・:：,，.。!！?？'"“”‘’()（）\[\]【】{}<>《》_\-–—/\\]+/g, '')
    .trim()
}

function positiveNumber (value) {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function seasonValue (value) {
  if (!value) return null
  const direct = positiveNumber(value.season ?? value.seasonNumber ?? value.season_no)
  if (direct) return direct
  const text = [value.seasonName, value.name, value.title, value.type, value.vod_name].filter(Boolean).join(' ')
  const match = text.match(/(?:第\s*(\d+)\s*季|season\s*(\d+)|\bs(\d{1,2})\b)/i)
  return match ? Number(match[1] || match[2] || match[3]) : null
}

function genericEpisodeLabel (value) {
  return GENERIC_EPISODE_LABELS.has(normalizeTitle(value))
}

function episodeValue (value) {
  if (!value) return null
  const direct = positiveNumber(value.episode ?? value.episodeNumber ?? value.episode_no)
  if (direct) return direct
  if (value.episodeIndex !== undefined && value.episodeIndex !== null && value.episodeIndex !== '') {
    const index = Number(value.episodeIndex)
    if (Number.isFinite(index) && index >= 0) return index + 1
  }
  const label = value.episodeName ?? value.episodeLabel ?? value.ep ?? ''
  if (genericEpisodeLabel(label)) return null
  const text = String(label || value.name || value.title || '')
  const match = text.match(/(?:第\s*(\d+)\s*(?:集|话|期)|\be(?:p(?:isode)?)?\s*0*(\d+)\b)/i)
  return match ? Number(match[1] || match[2]) : null
}

function tmdbValue (value) {
  const raw = value && (value.tmdbId ?? value.tmdb_id ?? value.tmdb)
  if (raw === undefined || raw === null || raw === '') return ''
  return String(raw).trim()
}

function doubanIdValue (value) {
  const raw = value && (value.doubanId ?? value.douban_id ?? value.id)
  if (raw === undefined || raw === null || raw === '') return ''
  return String(raw).trim()
}

function yearValue (value) {
  const match = String(value || '').match(/(?:19|20)\d{2}/)
  return match ? Number(match[0]) : null
}

function tokenSet (value) {
  return new Set(String(value || '').split(/[\s,，、/|]+/).map(normalizeTitle).filter(Boolean))
}

function overlap (left, right) {
  const a = tokenSet(left)
  const b = tokenSet(right)
  if (!a.size || !b.size) return false
  for (const item of a) if (b.has(item)) return true
  return false
}

function titleValues (value) {
  if (!value || typeof value !== 'object') return []
  const aliases = Array.isArray(value.aliases)
    ? value.aliases
    : [value.aliases, value.alias, value.vod_alias]
  const rows = [
    value.name,
    value.title,
    value.vod_name,
    value.originalTitle,
    value.original_title,
    value.vod_en,
    value.vod_sub,
    ...aliases
  ]
  const out = []
  for (const row of rows) {
    if (!row) continue
    const text = typeof row === 'object' ? (row.name || row.title || row.value || '') : row
    String(text).split(/[|｜]/).forEach(part => {
      const normalized = normalizeTitle(part)
      if (normalized && !out.includes(normalized)) out.push(normalized)
    })
  }
  return out
}

function bigrams (value) {
  const text = normalizeTitle(value)
  if (text.length < 2) return new Set(text ? [text] : [])
  const out = new Set()
  for (let index = 0; index < text.length - 1; index++) out.add(text.slice(index, index + 2))
  return out
}

function similarity (left, right) {
  const a = bigrams(left)
  const b = bigrams(right)
  if (!a.size || !b.size) return 0
  let common = 0
  for (const item of a) if (b.has(item)) common++
  return (2 * common) / (a.size + b.size)
}

function inferKind (detail) {
  const explicit = String(detail?.doubanKind || detail?.mediaType || detail?.kind || '').toLowerCase()
  if (['tv', 'series', 'show'].includes(explicit)) return 'tv'
  if (['movie', 'film'].includes(explicit)) return 'movie'
  const episodeCount = Number(detail?.episodeCount)
  if (Number.isFinite(episodeCount) && episodeCount > 1) return 'tv'
  const type = String(detail?.type || detail?.type_name || detail?.vod_class || '')
  if (/电影|影片|劇場版|剧场版|movie|film/i.test(type)) return 'movie'
  if (/电视剧|電視劇|连续剧|連續劇|剧集|劇集|番剧|番劇|动画剧集|動畫劇集|动漫剧集|動漫劇集|综艺|綜藝|\btv\b|series|show/i.test(type)) return 'tv'

  const lines = Array.isArray(detail?.fullList) ? detail.fullList : []
  for (const line of lines) {
    const entries = Array.isArray(line?.list) ? line.list : []
    if (entries.length <= 1) continue
    let episodic = 0
    for (const entry of entries.slice(0, 4)) {
      const label = String(entry || '').split('$')[0]
      if (!genericEpisodeLabel(label) && episodeValue({ episodeLabel: label })) episodic++
    }
    if (episodic >= Math.min(2, entries.length)) return 'tv'
  }
  return ''
}

function moviePlaybackEvidence (detail) {
  const lines = Array.isArray(detail?.fullList) ? detail.fullList : []
  let entries = 0
  let episodic = 0
  let movieLike = 0
  const movieLabel = /^(?:正片|本篇|feature|movie|film|hd(?:中字|国语|國語)?|bd|蓝光|藍光|4k|uhd|超清|高清|1080p?|720p?|原盘|原盤)$/i
  for (const line of lines) {
    const rows = Array.isArray(line?.list) ? line.list : []
    for (const entry of rows) {
      const label = String(entry || '').split('$')[0].trim()
      if (!label) continue
      entries++
      if (!genericEpisodeLabel(label) && episodeValue({ episodeLabel: label })) episodic++
      if (movieLabel.test(label.replace(/\s+/g, ''))) movieLike++
    }
  }
  return entries > 0 && movieLike > episodic
}

function rejectedMatch (exactTitle, reasons, reason) {
  return { score: 0, accepted: false, exactTitle, reasons: [...reasons, reason] }
}

function scoreIdentity (identity, candidate = {}, detail = {}) {
  const queryTitles = titleValues(identity)
  const candidateTitles = [...new Set([...titleValues(detail), ...titleValues(candidate)])]
  if (!candidateTitles.length || !queryTitles.length) return { score: 0, accepted: false, exactTitle: false, reasons: ['missing_title'] }

  let score = 0
  const reasons = []
  const exactTitle = queryTitles.some(title => candidateTitles.includes(title))
  if (exactTitle) {
    score += 82
    reasons.push('title_exact')
  } else {
    let best = 0
    for (const wanted of queryTitles) {
      for (const got of candidateTitles) best = Math.max(best, similarity(wanted, got))
    }
    if (best >= 0.88) {
      score += 66
      reasons.push('title_fuzzy_strong')
    } else if (best >= 0.72) {
      score += 52
      reasons.push('title_fuzzy')
    } else {
      return rejectedMatch(false, reasons, 'title_mismatch')
    }
  }

  const queryYear = yearValue(identity?.year)
  const candidateYear = yearValue(detail?.year || detail?.vod_year || candidate?.year || candidate?.vod_year)
  if (queryYear && candidateYear) {
    if (queryYear !== candidateYear) return rejectedMatch(exactTitle, reasons, 'year_mismatch')
    score += 8
    reasons.push('year_exact')
  }

  const queryTmdb = tmdbValue(identity)
  const candidateTmdb = tmdbValue(detail) || tmdbValue(candidate)
  if (queryTmdb && candidateTmdb) {
    if (queryTmdb !== candidateTmdb) return rejectedMatch(exactTitle, reasons, 'tmdb_mismatch')
    score += 10
    reasons.push('tmdb_exact')
  }

  const querySeason = seasonValue(identity)
  const candidateSeason = seasonValue(detail) || seasonValue(candidate)
  if (querySeason && candidateSeason) {
    if (querySeason !== candidateSeason) return rejectedMatch(exactTitle, reasons, 'season_mismatch')
    score += 5
    reasons.push('season_exact')
  }

  const queryKind = String(identity?.doubanKind || identity?.mediaType || identity?.kind || '').toLowerCase()
  const candidateKind = inferKind(detail) || inferKind(candidate)
  if (queryKind && queryKind !== 'unknown' && candidateKind) {
    if (queryKind !== candidateKind) return rejectedMatch(exactTitle, reasons, 'kind_mismatch')
    score += 5
    reasons.push('kind_exact')
  }

  if (queryKind === 'movie' && !candidateKind && moviePlaybackEvidence(detail)) {
    score += 3
    reasons.push('movie_playback_shape')
  }

  if (overlap((identity?.directors || []).join(' '), detail?.director || detail?.directors?.join(' '))) {
    score += 4
    reasons.push('director_overlap')
  }
  if (overlap((identity?.casts || []).join(' '), detail?.actor || detail?.casts?.join(' '))) {
    score += 3
    reasons.push('cast_overlap')
  }

  if (overlap((identity?.regions || []).join(' '), detail?.area || detail?.regions?.join(' '))) {
    score += 1
    reasons.push('region_overlap')
  }
  if (overlap((identity?.languages || []).join(' '), detail?.language || detail?.languages?.join(' '))) {
    score += 1
    reasons.push('language_overlap')
  }

  const accuracy = Math.min(100, Math.max(0, Math.round(score)))
  const requiredAccuracy = (!queryKind || queryKind === 'unknown') && candidateKind
    ? MATCH_THRESHOLD + 10
    : MATCH_THRESHOLD

  return {
    score: accuracy,
    accuracy,
    accepted: accuracy >= requiredAccuracy,
    exactTitle,
    reasons,
    candidateKind,
    candidateYear,
    candidateSeason,
    candidateTmdb
  }
}

function identityKey (identity) {
  return [
    'v3',
    doubanIdValue(identity),
    String(identity?.doubanKind || identity?.mediaType || identity?.kind || 'unknown'),
    tmdbValue(identity),
    normalizeTitle(identity?.title),
    yearValue(identity?.year) || '',
    seasonValue(identity) || ''
  ].join('|')
}

module.exports = {
  MATCH_THRESHOLD,
  normalizeTitle,
  yearValue,
  seasonValue,
  episodeValue,
  tmdbValue,
  doubanIdValue,
  genericEpisodeLabel,
  similarity,
  inferKind,
  scoreIdentity,
  identityKey
}
