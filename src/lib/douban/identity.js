'use strict'

const MATCH_THRESHOLD = 100
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
  const type = String(detail?.type || detail?.type_name || '')
  if (/电视剧|连续剧|剧集|动漫|动画|综艺|tv/i.test(type)) return 'tv'
  if (/电影|movie|film/i.test(type)) return 'movie'

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

function rejectedMatch (exactTitle, reasons, reason) {
  return { score: 0, accepted: false, exactTitle, reasons: [...reasons, reason] }
}

function scoreIdentity (identity, candidate = {}, detail = {}) {
  const queryTitles = [
    identity?.title,
    identity?.originalTitle,
    ...(Array.isArray(identity?.aliases) ? identity.aliases : [])
  ].map(normalizeTitle).filter(Boolean)
  const candidateTitle = normalizeTitle(detail?.name || detail?.vod_name || candidate?.name || candidate?.vod_name)
  if (!candidateTitle || !queryTitles.length) return { score: 0, accepted: false, exactTitle: false, reasons: ['missing_title'] }

  let score = 0
  const reasons = []
  const exactTitle = queryTitles.includes(candidateTitle)
  if (exactTitle) {
    score += 90
    reasons.push('title_primary_exact')
  } else {
    const best = Math.max(...queryTitles.map(title => similarity(title, candidateTitle)))
    if (best >= 0.88) {
      score += 78
      reasons.push('title_fuzzy_strong')
    } else if (best >= 0.72) {
      score += 64
      reasons.push('title_fuzzy')
    } else {
      return rejectedMatch(false, reasons, 'title_mismatch')
    }
  }

  const queryYear = yearValue(identity?.year)
  const candidateYear = yearValue(detail?.year || detail?.vod_year || candidate?.year || candidate?.vod_year)
  if (queryYear && candidateYear) {
    if (queryYear !== candidateYear) return rejectedMatch(exactTitle, reasons, 'year_mismatch')
    score += 14
    reasons.push('year_exact')
  }

  const queryTmdb = tmdbValue(identity)
  const candidateTmdb = tmdbValue(detail) || tmdbValue(candidate)
  if (queryTmdb && candidateTmdb) {
    if (queryTmdb !== candidateTmdb) return rejectedMatch(exactTitle, reasons, 'tmdb_mismatch')
    score += 20
    reasons.push('tmdb_exact')
  }

  const querySeason = seasonValue(identity)
  const candidateSeason = seasonValue(detail) || seasonValue(candidate)
  if (querySeason && candidateSeason) {
    if (querySeason !== candidateSeason) return rejectedMatch(exactTitle, reasons, 'season_mismatch')
    score += 10
    reasons.push('season_exact')
  }

  const queryEpisode = episodeValue(identity)
  const candidateEpisode = episodeValue(detail) || episodeValue(candidate)
  if (queryEpisode && candidateEpisode) {
    if (queryEpisode !== candidateEpisode) return rejectedMatch(exactTitle, reasons, 'episode_mismatch')
    score += 10
    reasons.push('episode_exact')
  }

  const queryKind = String(identity?.doubanKind || identity?.mediaType || identity?.kind || '').toLowerCase()
  const candidateKind = inferKind(detail) || inferKind(candidate)
  if (queryKind && queryKind !== 'unknown' && candidateKind) {
    if (queryKind !== candidateKind) return rejectedMatch(exactTitle, reasons, 'kind_mismatch')
    score += 8
    reasons.push('kind_exact')
  }

  if (overlap((identity?.directors || []).join(' '), detail?.director || detail?.directors?.join(' '))) {
    score += 8
    reasons.push('director_overlap')
  }
  if (overlap((identity?.casts || []).join(' '), detail?.actor || detail?.casts?.join(' '))) {
    score += 6
    reasons.push('cast_overlap')
  }

  return {
    score,
    accepted: score >= MATCH_THRESHOLD,
    exactTitle,
    reasons,
    candidateKind,
    candidateYear,
    candidateSeason,
    candidateEpisode,
    candidateTmdb
  }
}

function identityKey (identity) {
  return [
    'v2',
    String(identity?.doubanKind || identity?.mediaType || identity?.kind || 'unknown'),
    tmdbValue(identity),
    normalizeTitle(identity?.title),
    yearValue(identity?.year) || '',
    seasonValue(identity) || '',
    episodeValue(identity) || ''
  ].join('|')
}

module.exports = {
  MATCH_THRESHOLD,
  normalizeTitle,
  yearValue,
  seasonValue,
  episodeValue,
  tmdbValue,
  genericEpisodeLabel,
  similarity,
  inferKind,
  scoreIdentity,
  identityKey
}
