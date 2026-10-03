'use strict'

function normalizeGroups (fullList) {
  if (!Array.isArray(fullList)) return []
  return fullList.map(group => {
    if (!group || !Array.isArray(group.list)) return null
    const list = group.list
      .map(item => String(item || '').trim())
      .filter(Boolean)
    if (!list.length) return null
    return {
      flag: String(group.flag || ''),
      list
    }
  }).filter(Boolean)
}

function clampEpisodeIndex (index, length) {
  if (!Number.isFinite(Number(index)) || length <= 0) return 0
  return Math.min(length - 1, Math.max(0, Math.trunc(Number(index))))
}

function episodeNumberFromEntry (entry) {
  const label = String(entry || '').split('$')[0].trim()
  if (!label || /^(?:播放|立即播放|正片|本篇|movie|feature)$/i.test(label)) return null
  const match = label.match(/(?:第\s*0*(\d+)\s*(?:集|话|話|期)|\b(?:e|ep|episode)\s*0*(\d+)\b|^\s*0*(\d+)\s*$)/i)
  return match ? Number(match[1] || match[2] || match[3]) : null
}

function findEpisodeIndex (playlist, episode, fallbackIndex = 0) {
  const rows = Array.isArray(playlist) ? playlist : []
  const wanted = Number(episode)
  if (!rows.length) return -1
  if (!Number.isFinite(wanted) || wanted <= 0) return clampEpisodeIndex(fallbackIndex, rows.length)
  const parsed = rows.map(episodeNumberFromEntry)
  const exact = parsed.findIndex(value => value === wanted)
  if (exact >= 0) return exact
  if (parsed.some(value => value !== null)) return -1
  return clampEpisodeIndex(wanted - 1, rows.length)
}

function hasPlaybackHeaders (headers) {
  if (!headers) return false
  if (Array.isArray(headers)) return headers.some(row => {
    if (!row) return false
    if (typeof row === 'string') return row.trim().length > 0
    return typeof row === 'object' && Object.keys(row).length > 0
  })
  return typeof headers === 'object' && Object.keys(headers).length > 0
}

function choosePlaylist (fullList, preferredFlag, requestedIndex) {
  const groups = normalizeGroups(fullList)
  if (!groups.length) throw new Error('源未返回有效播放列表')

  const wanted = String(preferredFlag || '')
  let group = wanted ? groups.find(item => item.flag === wanted) : null
  const fallback = Boolean(wanted && !group)
  if (!group) group = groups[0]

  return {
    playlist: group.list,
    flag: group.flag,
    index: findEpisodeIndex(group.list, Number(requestedIndex) + 1, requestedIndex),
    fallback
  }
}

module.exports = {
  normalizeGroups,
  clampEpisodeIndex,
  findEpisodeIndex,
  hasPlaybackHeaders,
  choosePlaylist
}
