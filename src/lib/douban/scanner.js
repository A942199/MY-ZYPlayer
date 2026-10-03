'use strict'

const { getPlatformApi } = require('../platform/api')
const { sites } = require('../dexie')
const zy = require('../site/tools').default || require('../site/tools')
const myvideo = require('../site/myvideo')
const { normalizeTitle, similarity, yearValue, inferKind, scoreIdentity, identityKey, episodeValue, genericEpisodeLabel } = require('./identity')

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
  const row = providerHealth.get(site.key + '|' + sourceLocator(site))
  if (!row) return 0
  return (row.ok || 0) * 12 - (row.fail || 0) * 7 - Math.min(10, Math.round((row.latency || 0) / 1000))
}

function updateHealth (site, ok, latency) {
  const key = site.key + '|' + sourceLocator(site)
  const row = providerHealth.get(key) || { ok: 0, fail: 0, latency: 0 }
  if (ok) row.ok++
  else row.fail++
  row.latency = row.latency ? Math.round(row.latency * 0.7 + latency * 0.3) : latency
  providerHealth.set(key, row)
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

function candidatePreScore (identity, candidate) {
  const wanted = [identity?.title, identity?.originalTitle, ...(identity?.aliases || [])].filter(Boolean)
  const title = candidate?.name || candidate?.vod_name || ''
  const normalized = normalizeTitle(title)
  if (!normalized || !wanted.length) return -1000
  const normalizedWanted = wanted.map(normalizeTitle).filter(Boolean)
  let score = normalizedWanted.includes(normalized)
    ? 100
    : Math.round(Math.max(...wanted.map(value => similarity(value, title))) * 70)
  const wantedYear = yearValue(identity?.year)
  const gotYear = yearValue(candidate?.year || candidate?.vod_year)
  if (wantedYear && gotYear) score += wantedYear === gotYear ? 20 : -120
  const wantedKind = String(identity?.doubanKind || identity?.mediaType || identity?.kind || '').toLowerCase()
  const gotKind = inferKind(candidate)
  if (wantedKind && wantedKind !== 'unknown' && gotKind) score += wantedKind === gotKind ? 10 : -120
  return score
}

function rankCandidates (identity, rows) {
  return [...rows]
    .map((candidate, index) => ({ candidate, index, preScore: candidatePreScore(identity, candidate) }))
    .sort((a, b) => b.preScore - a.preScore || a.index - b.index)
    .map(row => row.candidate)
}

function clampScore (value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
}

function qualityScore (row, verified) {
  const text = [row?.candidate?.note, row?.candidate?.name, row?.detail?.note, row?.detail?.type, verified?.line, verified?.probe?.manifestUrl, verified?.probe?.fragmentUrl]
    .filter(Boolean).join(' ').toLowerCase()
  const height = Number(verified?.probe?.height || 0)
  let score = 58
  if (height >= 2160) score = 100
  else if (height >= 1440) score = 92
  else if (height >= 1080) score = 84
  else if (height >= 720) score = 66
  else if (height >= 480) score = 45
  else if (/(?:2160p|4k|uhd)/i.test(text)) score = 100
  else if (/(?:1440p|2k)/i.test(text)) score = 92
  else if (/1080p/i.test(text)) score = 84
  else if (/720p/i.test(text)) score = 66
  else if (/(?:480p|576p)/i.test(text)) score = 45
  const bandwidth = Number(verified?.probe?.bandwidth || 0)
  if (bandwidth > 0) {
    const mbps = bandwidth / 1000000
    score += mbps >= 15 ? 8 : mbps >= 8 ? 5 : mbps >= 4 ? 2 : 0
  }
  return clampScore(score)
}

function smoothnessScore (verified, latency) {
  const throughput = Number(verified?.probe?.throughputMbps || 0)
  const bandwidth = Number(verified?.probe?.bandwidth || 0) / 1000000
  let score
  if (throughput > 0 && bandwidth > 0) {
    const ratio = throughput / bandwidth
    score = ratio >= 5 ? 100 : ratio >= 3 ? 92 : ratio >= 2 ? 82 : ratio >= 1.5 ? 68 : ratio >= 1.2 ? 52 : 28
  } else if (throughput > 0) {
    score = throughput >= 30 ? 100 : throughput >= 15 ? 92 : throughput >= 8 ? 82 : throughput >= 4 ? 68 : throughput >= 2 ? 52 : 35
  } else {
    score = latency <= 500 ? 90 : latency <= 1000 ? 80 : latency <= 2000 ? 65 : latency <= 3500 ? 48 : 30
  }
  return clampScore(score)
}

function stabilityScore (site) {
  const row = providerHealth.get(site.key + '|' + sourceLocator(site))
  if (!row || !(row.ok + row.fail)) return 75
  const success = row.ok / Math.max(1, row.ok + row.fail)
  const latency = row.latency <= 800 ? 20 : row.latency <= 1600 ? 15 : row.latency <= 3000 ? 8 : 2
  return clampScore(success * 80 + latency)
}

function compositeScore ({ accuracy, quality, smoothness, stability }) {
  return Math.round((accuracy * 0.50 + quality * 0.25 + smoothness * 0.20 + stability * 0.05) * 100) / 100
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
  const settled = await Promise.allSettled(terms.map(text => zy.search(site.key, text)))
  const successful = settled.filter(row => row.status === 'fulfilled')
  const failures = settled.filter(row => row.status === 'rejected')
  if (!successful.length && failures.length) {
    const error = failures[0].reason instanceof Error ? failures[0].reason : new Error(String(failures[0].reason || 'Search failed'))
    error.code = error.code || 'SEARCH_ERROR'
    throw error
  }
  const batches = successful.map(row => Array.isArray(row.value) ? row.value : [])
  const deduped = dedupeCandidates(batches.flat()).slice(0, 50)
  return {
    candidates: rankCandidates(identity, deduped).slice(0, 16),
    hadErrors: failures.length > 0
  }
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

  const labeled = entries.map(entry => ({
    entry,
    value: (() => {
      const { label } = splitEpisode(entry)
      if (genericEpisodeLabel(label)) return null
      return episodeValue({ episodeLabel: label })
    })()
  })).filter(row => row.value)
  const byLabel = labeled.find(row => row.value === episode)
  if (byLabel) return [byLabel.entry]
  if (labeled.length) return []

  const byPosition = entries[episode - 1]
  if (byPosition) return [byPosition]
  return []
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

function retryableProbeFailure (probe, error) {
  if (error) return true
  const code = String(probe?.code || '')
  if (['PROBE_ERROR', 'HLS_NO_PLAYABLE_VARIANT'].includes(code)) return true
  const status = Number(probe?.status || (code.match(/^HTTP_(\d+)$/) || [])[1])
  return [408, 425, 429].includes(status) || (status >= 500 && status <= 599)
}

async function verifyDetail (site, detail, identity) {
  const lines = sortLines(site, Array.isArray(detail?.fullList) ? detail.fullList : [])
  let retryableFailure = false
  for (const line of lines) {
    const entries = Array.isArray(line?.list) ? line.list : []
    if (!entries.length) continue
    const probeEntries = episodeProbeEntries(entries, identity)
    for (const entry of probeEntries) {
      try {
        const resolved = await resolveEpisode(site, entry)
        if (!/^https?:\/\//i.test(resolved.url)) continue
        const probe = await getPlatformApi().douban.probe({
          url: resolved.url,
          headers: resolved.headers,
          timeout: 4500
        })
        if (probe?.ok) {
          recordLine(site, line.flag, true)
          return { ok: true, line: line.flag, episode: resolved.label, probe }
        }
        if (retryableProbeFailure(probe)) retryableFailure = true
      } catch (error) {
        retryableFailure = retryableProbeFailure(null, error) || retryableFailure
      }
    }
    recordLine(site, line.flag, false)
  }
  return { ok: false, code: retryableFailure ? 'PROBE_ERROR' : 'NO_PLAYABLE_LINE' }
}

async function scanProvider (site, identity) {
  const started = now()
  try {
    const search = await searchProvider(site, identity)
    const candidates = rankCandidates(identity, search.candidates)
    const scored = []
    let detailFailures = 0
    for (const candidate of candidates.slice(0, 8)) {
      const id = candidateId(candidate)
      if (!id) continue
      let detail
      try {
        detail = await zy.detail(site.key, id)
      } catch (error) {
        detailFailures++
        continue
      }
      if (!detail) continue
      const match = scoreIdentity(identity, candidate, detail)
      if (!match.accepted) continue
      scored.push({ candidate, detail, match })
    }
    if (!scored.length && (search.hadErrors || detailFailures > 0)) {
      const latency = now() - started
      updateHealth(site, false, latency)
      return { ok: false, site, latency, code: search.hadErrors ? 'SEARCH_ERROR' : 'DETAIL_ERROR' }
    }
    scored.sort((a, b) => b.match.score - a.match.score)
    let retryableProbe = false
    for (const row of scored) {
      const verified = await verifyDetail(site, row.detail, identity)
      if (!verified.ok) {
        if (verified.code === 'PROBE_ERROR') retryableProbe = true
        continue
      }
      const latency = now() - started
      const accuracy = Number(row.match.accuracy ?? row.match.score) || 0
      const quality = qualityScore(row, verified)
      const smoothness = smoothnessScore(verified, latency)
      const stability = stabilityScore(site)
      const finalScore = compositeScore({ accuracy, quality, smoothness, stability })
      updateHealth(site, true, latency)
      return {
        ok: true,
        site,
        providerKind: providerKind(site),
        score: row.match.score,
        accuracy,
        qualityScore: quality,
        smoothnessScore: smoothness,
        stabilityScore: stability,
        finalScore,
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
    return { ok: false, site, latency, code: retryableProbe ? 'PROBE_ERROR' : (scored.length ? 'NOT_PLAYABLE' : 'NO_MATCH') }
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

async function runPool (items, concurrency, worker, onResult, shouldStop = () => false) {
  let cursor = 0
  async function runner () {
    while (cursor < items.length && !shouldStop()) {
      const index = cursor++
      const value = await worker(items[index], index)
      if (!shouldStop()) onResult(value, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runner))
}

function rankResults (rows) {
  return [...rows].sort((a, b) =>
    Number(b.finalScore || 0) - Number(a.finalScore || 0) ||
    Number(b.accuracy || b.score || 0) - Number(a.accuracy || a.score || 0) ||
    Number(b.qualityScore || 0) - Number(a.qualityScore || 0) ||
    Number(b.smoothnessScore || 0) - Number(a.smoothnessScore || 0) ||
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
    incomplete: Boolean(entry.hadTransientFailure),
    firstPlayable: entry.firstPlayable,
    results: rankResults(entry.results),
    top5: rankResults(entry.results).slice(0, 5)
  }
  entry.listeners.forEach(listener => {
    try { listener(snapshot) } catch (error) {}
  })
}

async function scanPhase (entry, rows, identity, phase) {
  if (!rows.length || entry.cancelled) return
  entry.phase = phase
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
  }, () => entry.cancelled)

  const retryLimit = phase === 'cms' ? 4 : 8
  const retrySites = failed.slice(0, retryLimit)
  for (const site of retrySites) {
    if (entry.cancelled) break
    const retry = await scanProvider(site, identity)
    if (retry.ok && !entry.results.some(row => row.site.key === site.key)) {
      entry.results.push(retry)
      if (!entry.firstPlayable) entry.firstPlayable = retry
    } else if (!retry.ok && !['NO_MATCH', 'NOT_PLAYABLE'].includes(retry.code)) {
      entry.hadTransientFailure = true
    }
    emit(entry)
  }
  if (failed.length > retrySites.length) entry.hadTransientFailure = true
}

async function executeScan (entry, identity) {
  const allSites = (await sites.all())
    .filter(site => site && site.isActive !== false)
    .sort((a, b) => healthScore(b) - healthScore(a))
  if (entry.cancelled) return []
  const { cms, bd } = partitionSites(allSites)
  entry.cmsTotal = cms.length
  entry.bdTotal = bd.length
  entry.total = allSites.length
  emit(entry)

  // Rank the whole work/season once across every enabled provider. Playback
  // stays pinned to the provider the user opens; episodes never trigger a new scan.
  await scanPhase(entry, cms, identity, 'cms')
  if (!entry.cancelled) await scanPhase(entry, bd, identity, 'bd')

  if (entry.cancelled) return []

  entry.status = 'complete'
  entry.phase = 'complete'
  entry.results = rankResults(entry.results)
  if (entry.results.length) cachePut(resultCache, entry.key, entry.results, SUCCESS_TTL)
  else if (!entry.hadTransientFailure) cachePut(missCache, entry.key, true, MISS_TTL)
  emit(entry)
  return entry.results
}

function scan (identity, listener) {
  const sourceRevision = typeof sites.revision === 'function' ? sites.revision() : 0
  const key = identityKey(identity) + '|sources:' + sourceRevision
  const cached = liveCache(resultCache, key)
  if (cached) {
    const snapshot = { key, status: 'complete', phase: 'cache', total: 0, completed: 0, cmsTotal: 0, cmsCompleted: 0, bdTotal: 0, bdCompleted: 0, incomplete: false, firstPlayable: cached[0] || null, results: cached, top5: cached.slice(0, 5) }
    if (listener) listener(snapshot)
    return {
      key,
      promise: Promise.resolve(cached),
      subscribe: next => {
        if (next) next(snapshot)
        return () => {}
      }
    }
  }
  if (liveCache(missCache, key)) {
    const snapshot = { key, status: 'complete', phase: 'cache', total: 0, completed: 0, cmsTotal: 0, cmsCompleted: 0, bdTotal: 0, bdCompleted: 0, incomplete: false, firstPlayable: null, results: [], top5: [] }
    if (listener) listener(snapshot)
    return {
      key,
      promise: Promise.resolve([]),
      subscribe: next => {
        if (next) next(snapshot)
        return () => {}
      }
    }
  }

  let entry = sharedScans.get(key)
  if (entry?.cancelled) {
    sharedScans.delete(key)
    entry = null
  }
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
      hadTransientFailure: false,
      firstPlayable: null,
      results: [],
      listeners: new Set(),
      cancelled: false,
      promise: null
    }
    sharedScans.set(key, entry)
    entry.promise = executeScan(entry, identity).finally(() => {
      if (sharedScans.get(key) === entry) sharedScans.delete(key)
      entry.listeners.clear()
    })
  }
  if (listener) entry.listeners.add(listener)
  const maybeCancel = () => {
    if (entry.status === 'complete' || entry.cancelled || entry.listeners.size) return
    entry.cancelled = true
    if (sharedScans.get(key) === entry) sharedScans.delete(key)
  }
  const subscribe = next => {
    entry.listeners.add(next)
    emit(entry)
    return () => {
      entry.listeners.delete(next)
      maybeCancel()
    }
  }
  emit(entry)
  return {
    key,
    promise: entry.promise,
    subscribe,
    unsubscribe: listener
      ? () => {
          entry.listeners.delete(listener)
          maybeCancel()
        }
      : () => {}
  }
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
