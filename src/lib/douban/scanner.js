'use strict'

const { ipcRenderer } = require('electron')
const { sites } = require('../dexie')
const zy = require('../site/tools').default || require('../site/tools')
const myvideo = require('../site/myvideo')
const { normalizeTitle, scoreIdentity, identityKey, episodeValue, genericEpisodeLabel } = require('./identity')

const sharedScans = new Map()
const providerHealth = new Map()
const lineHealth = new Map()
const resultCache = new Map()
const missCache = new Map()
const SUCCESS_TTL = 10 * 60 * 1000
const MISS_TTL = 2 * 60 * 1000

function now () { return Date.now() }

function liveCache (map, key) {
  const row = map.get(key)
  if (!row) return null
  if (row.expires <= now()) {
    map.delete(key)
    return null
  }
  return row.value
}

function cachePut (map, key, value, ttl) {
  map.set(key, { value, expires: now() + ttl })
  if (map.size > 128) {
    const oldest = map.keys().next().value
    map.delete(oldest)
  }
}

function healthScore (site) {
  const row = providerHealth.get(site.key)
  if (!row) return 0
  return (row.ok || 0) * 12 - (row.fail || 0) * 7 - Math.min(10, Math.round((row.latency || 0) / 1000))
}

function updateHealth (site, ok, latency) {
  const row = providerHealth.get(site.key) || { ok: 0, fail: 0, latency: 0 }
  if (ok) row.ok++
  else row.fail++
  row.latency = row.latency ? Math.round(row.latency * 0.7 + latency * 0.3) : latency
  providerHealth.set(site.key, row)
}

function sourceLocator (site) {
  return String(site?.ext || site?.api || site?.key || '')
}

function lineKey (site, flag) {
  return sourceLocator(site) + '|' + String(flag || '')
}

function sortLines (site, lines) {
  return [...lines].sort((a, b) => {
    const av = lineHealth.get(lineKey(site, a.flag))
    const bv = lineHealth.get(lineKey(site, b.flag))
    const as = av && av.expires > now() ? av.score : 0
    const bs = bv && bv.expires > now() ? bv.score : 0
    return bs - as
  })
}

function recordLine (site, flag, ok) {
  lineHealth.set(lineKey(site, flag), {
    score: ok ? 10 : -6,
    expires: now() + (ok ? SUCCESS_TTL : MISS_TTL)
  })
  if (lineHealth.size > 96) lineHealth.delete(lineHealth.keys().next().value)
}

function candidateId (item) {
  return String(item?.id ?? item?.vod_id ?? item?.ids ?? '')
}

function dedupeCandidates (rows) {
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const key = candidateId(row) || normalizeTitle(row?.name || row?.vod_name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function providerKind (site) {
  return myvideo.isSource(site) ? 'BD' : 'CMS'
}

function partitionSites (rows) {
  const cms = []
  const bd = []
  for (const site of rows) {
    if (providerKind(site) === 'BD') bd.push(site)
    else cms.push(site)
  }
  return { cms, bd }
}

async function searchProvider (site, identity) {
  const terms = [identity.title, identity.originalTitle, ...(identity.aliases || [])]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, array) => array.findIndex(other => normalizeTitle(other) === normalizeTitle(value)) === index)
    .slice(0, 3)
  const batches = await Promise.all(terms.map(async text => {
    try {
      const rows = await zy.search(site.key, text)
      return Array.isArray(rows) ? rows : []
    } catch (error) {
      return []
    }
  }))
  return dedupeCandidates(batches.flat()).slice(0, 10)
}

function splitEpisode (entry) {
  const text = String(entry || '')
  const at = text.indexOf('$')
  return {
    label: at >= 0 ? text.slice(0, at) : '',
    marker: at >= 0 ? text.slice(at + 1) : text
  }
}

function episodeProbeEntries (entries, identity) {
  if (!Array.isArray(entries) || !entries.length) return []
  const episode = episodeValue(identity)
  if (!episode) {
    return entries.length > 1
      ? [entries[0], entries[Math.min(entries.length - 1, 1)]]
      : [entries[0]]
  }

  const byPosition = entries[episode - 1]
  if (byPosition) return [byPosition]

  const byLabel = entries.find(entry => {
    const { label } = splitEpisode(entry)
    if (genericEpisodeLabel(label)) return false
    return episodeValue({ episodeLabel: label }) === episode
  })
  return byLabel ? [byLabel] : []
}

async function resolveEpisode (site, entry) {
  const { label, marker } = splitEpisode(entry)
  if (marker.startsWith('myvideo-play:')) {
    const resolved = await zy.resolvePlay(site.key, marker)
    return {
      label,
      url: String(resolved?.url || ''),
      headers: resolved?.headers || []
    }
  }
  return { label, url: marker, headers: [] }
}

async function verifyDetail (site, detail, identity) {
  const lines = sortLines(site, Array.isArray(detail?.fullList) ? detail.fullList : [])
  for (const line of lines) {
    const entries = Array.isArray(line?.list) ? line.list : []
    if (!entries.length) continue
    const probeEntries = episodeProbeEntries(entries, identity)
    for (const entry of probeEntries) {
      try {
        const resolved = await resolveEpisode(site, entry)
        if (!/^https?:\/\//i.test(resolved.url)) continue
        const probe = await ipcRenderer.invoke('douban:probe', {
          url: resolved.url,
          headers: resolved.headers,
          timeout: 4500
        })
        if (probe?.ok) {
          recordLine(site, line.flag, true)
          return { ok: true, line: line.flag, episode: resolved.label, probe }
        }
      } catch (error) {}
    }
    recordLine(site, line.flag, false)
  }
  return { ok: false, code: 'NO_PLAYABLE_LINE' }
}

async function scanProvider (site, identity) {
  const started = now()
  try {
    const candidates = await searchProvider(site, identity)
    const scored = []
    for (const candidate of candidates.slice(0, 6)) {
      const id = candidateId(candidate)
      if (!id) continue
      let detail
      try {
        detail = await zy.detail(site.key, id)
      } catch (error) {
        continue
      }
      if (!detail) continue
      const match = scoreIdentity(identity, candidate, detail)
      if (!match.accepted) continue
      scored.push({ candidate, detail, match })
    }
    scored.sort((a, b) => b.match.score - a.match.score)
    for (const row of scored) {
      const verified = await verifyDetail(site, row.detail, identity)
      if (!verified.ok) continue
      const latency = now() - started
      updateHealth(site, true, latency)
      return {
        ok: true,
        site,
        providerKind: providerKind(site),
        score: row.match.score,
        reasons: row.match.reasons,
        candidate: row.candidate,
        detail: row.detail,
        line: verified.line,
        episode: verified.episode,
        probe: verified.probe,
        latency
      }
    }
    const latency = now() - started
    updateHealth(site, false, latency)
    return { ok: false, site, latency, code: scored.length ? 'NOT_PLAYABLE' : 'NO_MATCH' }
  } catch (error) {
    const latency = now() - started
    updateHealth(site, false, latency)
    return { ok: false, site, latency, code: error.code || 'PROVIDER_ERROR', error: error.message }
  }
}

function concurrencyFor (count) {
  const cores = Number(globalThis.navigator?.hardwareConcurrency || 4)
  if (count >= 24 && cores >= 8) return 6
  if (count >= 12) return 4
  return 3
}

async function runPool (items, concurrency, worker, onResult) {
  let cursor = 0
  async function runner () {
    while (cursor < items.length) {
      const index = cursor++
      const value = await worker(items[index], index)
      onResult(value, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runner))
}

function rankResults (rows) {
  return [...rows].sort((a, b) =>
    b.score - a.score ||
    healthScore(b.site) - healthScore(a.site) ||
    a.latency - b.latency
  )
}

function emit (entry) {
  const snapshot = {
    key: entry.key,
    status: entry.status,
    phase: entry.phase,
    total: entry.total,
    completed: entry.completed,
    cmsTotal: entry.cmsTotal,
    cmsCompleted: entry.cmsCompleted,
    bdTotal: entry.bdTotal,
    bdCompleted: entry.bdCompleted,
    firstPlayable: entry.firstPlayable,
    results: rankResults(entry.results),
    top5: rankResults(entry.results).slice(0, 5)
  }
  entry.listeners.forEach(listener => {
    try { listener(snapshot) } catch (error) {}
  })
}

async function scanPhase (entry, rows, identity, phase) {
  if (!rows.length) return
  entry.phase = phase
  entry.total = entry.completed + rows.length
  emit(entry)

  const failed = []
  const concurrency = phase === 'cms'
    ? Math.min(3, Math.max(1, rows.length))
    : concurrencyFor(rows.length)

  await runPool(rows, concurrency, async site => scanProvider(site, identity), row => {
    entry.completed++
    if (phase === 'cms') entry.cmsCompleted++
    else entry.bdCompleted++

    if (row.ok) {
      entry.results.push(row)
      if (!entry.firstPlayable) entry.firstPlayable = row
    } else if (!['NO_MATCH', 'NOT_PLAYABLE'].includes(row.code)) {
      failed.push(row.site)
    }
    emit(entry)
  })

  const retryLimit = phase === 'cms' ? 4 : 8
  for (const site of failed.slice(0, retryLimit)) {
    const retry = await scanProvider(site, identity)
    if (retry.ok && !entry.results.some(row => row.site.key === site.key)) {
      entry.results.push(retry)
      if (!entry.firstPlayable) entry.firstPlayable = retry
    }
    emit(entry)
  }
}

async function executeScan (entry, identity) {
  const allSites = (await sites.all())
    .filter(site => site && site.isActive !== false)
    .sort((a, b) => healthScore(b) - healthScore(a))
  const { cms, bd } = partitionSites(allSites)
  entry.cmsTotal = cms.length
  entry.bdTotal = bd.length
  entry.total = cms.length
  emit(entry)

  // myvideo contract: CMS is the primary identity/playability path.
  // BD/CSP is a fallback only when exhaustive CMS matching produced no playable provider.
  await scanPhase(entry, cms, identity, 'cms')

  if (!entry.results.length) {
    await scanPhase(entry, bd, identity, 'bd')
  }

  entry.status = 'complete'
  entry.phase = 'complete'
  entry.results = rankResults(entry.results)
  if (entry.results.length) cachePut(resultCache, entry.key, entry.results, SUCCESS_TTL)
  else cachePut(missCache, entry.key, true, MISS_TTL)
  emit(entry)
  return entry.results
}

function scan (identity, listener) {
  const key = identityKey(identity)
  const cached = liveCache(resultCache, key)
  if (cached) {
    const snapshot = { key, status: 'complete', phase: 'cache', total: 0, completed: 0, cmsTotal: 0, cmsCompleted: 0, bdTotal: 0, bdCompleted: 0, firstPlayable: cached[0] || null, results: cached, top5: cached.slice(0, 5) }
    if (listener) listener(snapshot)
    return { key, promise: Promise.resolve(cached), subscribe: () => () => {} }
  }
  if (liveCache(missCache, key)) {
    const snapshot = { key, status: 'complete', phase: 'cache', total: 0, completed: 0, cmsTotal: 0, cmsCompleted: 0, bdTotal: 0, bdCompleted: 0, firstPlayable: null, results: [], top5: [] }
    if (listener) listener(snapshot)
    return { key, promise: Promise.resolve([]), subscribe: () => () => {} }
  }

  let entry = sharedScans.get(key)
  if (!entry) {
    entry = {
      key,
      status: 'scanning',
      phase: 'cms',
      total: 0,
      completed: 0,
      cmsTotal: 0,
      cmsCompleted: 0,
      bdTotal: 0,
      bdCompleted: 0,
      firstPlayable: null,
      results: [],
      listeners: new Set(),
      promise: null
    }
    sharedScans.set(key, entry)
    entry.promise = executeScan(entry, identity).finally(() => {
      setTimeout(() => sharedScans.delete(key), 60 * 1000)
    })
  }
  if (listener) entry.listeners.add(listener)
  const subscribe = next => {
    entry.listeners.add(next)
    emit(entry)
    return () => entry.listeners.delete(next)
  }
  emit(entry)
  return { key, promise: entry.promise, subscribe }
}

module.exports = {
  scan,
  scanProvider,
  rankResults,
  providerKind,
  partitionSites,
  splitEpisode,
  episodeProbeEntries,
  resolveEpisode,
  _state: { sharedScans, providerHealth, lineHealth, resultCache, missCache }
}
