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
    index: clampEpisodeIndex(requestedIndex, group.list.length),
    fallback
  }
}

module.exports = {
  normalizeGroups,
  clampEpisodeIndex,
  choosePlaylist
}
