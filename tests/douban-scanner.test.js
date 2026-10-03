'use strict'

const assert = require('assert')
const fs = require('fs')
const vm = require('vm')
const identity = require('../src/lib/douban/identity')

function loadScanner (overrides = {}) {
  const code = fs.readFileSync(require.resolve('../src/lib/douban/scanner'), 'utf8')
  const module = { exports: {} }
  const sites = overrides.sites || { all: async () => [], revision: () => 0 }
  const zy = overrides.zy || { search: async () => [], detail: async () => null, resolvePlay: async () => null }
  const platform = overrides.platform || { douban: { probe: async () => ({ ok: false, code: 'HTTP_404' }) } }
  const myvideo = overrides.myvideo || { isSource: () => false }
  const localRequire = request => {
    if (request === '../platform/api') return { getPlatformApi: () => platform }
    if (request === '../dexie') return { sites }
    if (request === '../site/tools') return { default: zy }
    if (request === '../site/myvideo') return myvideo
    if (request === './identity') return identity
    throw new Error('Unexpected scanner dependency: ' + request)
  }
  vm.runInThisContext('(function(require,module,exports){' + code + '\n})', { filename: 'scanner.test.vm.js' })(localRequire, module, module.exports)
  return module.exports
}

async function main () {
  const scanner = loadScanner()
  assert.deepStrictEqual(
    scanner.episodeProbeEntries([
      '特别篇$https://example.invalid/special.mp4',
      '第01集$https://example.invalid/1.mp4'
    ], { episode: 1 }),
    ['第01集$https://example.invalid/1.mp4'],
    'Explicit episode labels must win over array position'
  )

  const failedSearchScanner = loadScanner({
    zy: {
      search: async () => { throw new Error('upstream timeout') },
      detail: async () => null,
      resolvePlay: async () => null
    }
  })
  const failedSearch = await failedSearchScanner.scanProvider({ key: 'cms-timeout' }, { title: '作品', year: 2024, kind: 'movie' })
  assert.notStrictEqual(failedSearch.code, 'NO_MATCH', 'Transport failures must not be misclassified as NO_MATCH')

  const buriedCandidates = Array.from({ length: 6 }, (_, index) => ({ id: 'wrong-' + index, name: '完全不同' + index, year: 2024 }))
    .concat([{ id: 'right', name: '目标作品', year: 2024 }])
  const buriedScanner = loadScanner({
    zy: {
      search: async () => buriedCandidates,
      detail: async (key, id) => id === 'right'
        ? { id, name: '目标作品', year: 2024, kind: 'movie', fullList: [{ flag: '1080P', list: ['正片$https://example.invalid/good.mp4'] }] }
        : { id, name: '完全不同', year: 2024, kind: 'movie', fullList: [{ flag: 'line', list: ['正片$https://example.invalid/wrong.mp4'] }] },
      resolvePlay: async () => null
    },
    platform: { douban: { probe: async payload => ({ ok: payload.url.includes('good'), status: 206, kind: 'direct', bytes: 262144, elapsedMs: 100, throughputMbps: 20 }) } }
  })
  const buried = await buriedScanner.scanProvider({ key: 'cms-buried', api: 'https://example.invalid' }, { title: '目标作品', year: 2024, kind: 'movie' })
  assert.strictEqual(buried.ok, true, 'Candidate pre-ranking must recover an exact match even when provider lists it after six weak results')
  assert.strictEqual(buried.candidate.id, 'right')
  assert(buried.accuracy >= 85)
  assert(Number.isFinite(buried.finalScore))
  assert(Number.isFinite(buried.qualityScore))
  assert(Number.isFinite(buried.smoothnessScore))
  assert(Number.isFinite(buried.stabilityScore))

  const deepCandidates = Array.from({ length: 10 }, (_, index) => ({ id: 'deep-wrong-' + index, name: '噪声结果' + index, year: 2024 }))
    .concat([{ id: 'deep-right', name: '深层目标', year: 2024 }])
  const deepScanner = loadScanner({
    zy: {
      search: async () => deepCandidates,
      detail: async (key, id) => id === 'deep-right'
        ? { id, name: '深层目标', year: 2024, kind: 'movie', fullList: [{ flag: '1080P', list: ['正片$https://example.invalid/deep.mp4'] }] }
        : { id, name: '噪声', year: 2024, kind: 'movie', fullList: [{ flag: 'line', list: ['正片$https://example.invalid/noise.mp4'] }] },
      resolvePlay: async () => null
    },
    platform: { douban: { probe: async payload => ({ ok: payload.url.includes('deep'), status: 206, kind: 'direct', bytes: 262144, elapsedMs: 100, throughputMbps: 20 }) } }
  })
  const deep = await deepScanner.scanProvider({ key: 'cms-deep', api: 'https://example.invalid' }, { title: '深层目标', year: 2024, kind: 'movie' })
  assert.strictEqual(deep.ok, true, 'Candidate ranking must happen before raw provider results are truncated')
  assert.strictEqual(deep.candidate.id, 'deep-right')

  const ranked = buriedScanner.rankResults([
    { site: { key: 'fast-wrongish', api: 'a' }, accuracy: 86, qualityScore: 100, smoothnessScore: 100, stabilityScore: 100, finalScore: 93 },
    { site: { key: 'accurate', api: 'b' }, accuracy: 99, qualityScore: 82, smoothnessScore: 90, stabilityScore: 90, finalScore: 93.35 }
  ])
  assert.strictEqual(ranked[0].site.key, 'accurate', 'Final provider order must use the computed composite score with accuracy as the dominant input')

  let searchAttempts = 0
  const retryScanner = loadScanner({
    sites: {
      all: async () => [{ key: 'cms-retry', api: 'https://example.invalid', isActive: true }],
      revision: () => 0
    },
    zy: {
      search: async () => {
        searchAttempts++
        if (searchAttempts === 1) throw new Error('temporary timeout')
        return [{ id: 'candidate', name: '作品', year: 2024 }]
      },
      detail: async () => ({
        id: 'candidate',
        name: '作品',
        year: 2024,
        kind: 'movie',
        fullList: [{ flag: 'line', list: ['正片$https://example.invalid/video.mp4'] }]
      }),
      resolvePlay: async () => null
    },
    platform: { douban: { probe: async () => ({ ok: true, status: 206 }) } }
  })
  const retryHandle = retryScanner.scan({ id: '88', title: '作品', year: 2024, kind: 'movie' })
  retryHandle.subscribe(() => {})
  const retryResults = await retryHandle.promise
  assert.strictEqual(searchAttempts, 2, 'Transient provider search failure should receive one deferred retry')
  assert.strictEqual(retryResults.length, 1)

  const persistentFailureScanner = loadScanner({
    sites: {
      all: async () => [{ key: 'cms-down', api: 'https://example.invalid', isActive: true }],
      revision: () => 0
    },
    zy: {
      search: async () => { throw new Error('still unavailable') },
      detail: async () => null,
      resolvePlay: async () => null
    }
  })
  let finalFailureState = null
  const persistentFailureHandle = persistentFailureScanner.scan({ id: '99', title: '网络失败', year: 2024, kind: 'movie' })
  persistentFailureHandle.subscribe(state => { finalFailureState = state })
  await persistentFailureHandle.promise
  assert.strictEqual(persistentFailureScanner._state.missCache.has(persistentFailureHandle.key), false, 'Unresolved transport failures must never poison the miss cache')
  assert.strictEqual(finalFailureState.incomplete, true, 'UI state must distinguish incomplete scans from confirmed misses')

  let revision = 0
  const revisionScanner = loadScanner({ sites: { all: async () => [], revision: () => revision } })
  const subject = { id: '1292052', title: '肖申克的救赎', year: 1994, kind: 'movie' }
  const firstKey = revisionScanner.scan(subject).key
  revision = 1
  const secondKey = revisionScanner.scan(subject).key
  assert.notStrictEqual(firstKey, secondKey, 'Source configuration revision must participate in scan/cache identity')

  let releaseSites
  const pendingSites = new Promise(resolve => { releaseSites = resolve })
  const cancelScanner = loadScanner({ sites: { all: () => pendingSites, revision: () => 0 } })
  const handle = cancelScanner.scan({ id: '42', title: '取消测试', year: 2024, kind: 'movie' })
  const unsubscribe = handle.subscribe(() => {})
  const entry = cancelScanner._state.sharedScans.get(handle.key)
  assert.strictEqual(entry.listeners.size, 1, 'A single subscriber should register exactly one listener')
  unsubscribe()
  assert.strictEqual(entry.listeners.size, 0)
  assert.strictEqual(entry.cancelled, true, 'Orphaned in-flight scans should be cancelled')
  releaseSites([])
  await handle.promise

  console.log('Douban scanner reliability tests passed')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
