'use strict'

const assert = require('assert')
const http = require('http')
const {
  normalizeLocalConfig,
  resolveDanmaku,
  setLocalDanmuProviderResolver,
  setLocalDanmuCacheResolver
} = require('../src/main/media-enhancement/runtime')

function listen (handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        base: 'http://127.0.0.1:' + server.address().port
      })
    })
  })
}

function close (server) {
  return new Promise(resolve => server.close(resolve))
}

async function main () {
  let mode = 'good'
  const local = await listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const json = value => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(value))
      }

      if (url.pathname === '/api/v2/match' && req.method === 'POST') {
        if (mode === 'timeout') {
          setTimeout(() => json({ isMatched: false, matches: [] }), 6000)
          return
        }
        if (mode === 'slowGood') {
          setTimeout(() => json({ isMatched: true, matches: [{ animeTitle: '胜者即是正义(2012)', episodeId: 'slow-good-e2', episodeTitle: 'S01E02', year: 2012 }] }), 3500)
          return
        }

        const candidates = {
          good: { animeTitle: '胜者即是正义(2012)', episodeId: 'good-e2', episodeTitle: 'S01E02', year: 2012 },
          missingEpisode: { animeTitle: '胜者即是正义(2012)', episodeId: 'weak-e2', episodeTitle: '未知集', year: 2012 },
          wrongEpisode: { animeTitle: '胜者即是正义(2012)', episodeId: 'wrong-e8', episodeTitle: 'S01E08', year: 2012 },
          wrongSeason: { animeTitle: '胜者即是正义 第二季(2012)', episodeId: 'wrong-s2e2', episodeTitle: 'S02E02', year: 2012 },
          wrongTitle: { animeTitle: '完全不同的作品(2012)', episodeId: 'wrong-title', episodeTitle: 'S01E02', year: 2012 },
          movieWrongYear: { animeTitle: '同名电影(2020)', episodeId: 'movie-2020', episodeTitle: '正片', year: 2020 },
          specialGood: { animeTitle: '测试剧 特别篇(2026)', episodeId: 'special-e2', episodeTitle: 'S00E02', year: 2026 }
        }
        const candidate = candidates[mode]
        json({ isMatched: Boolean(candidate), matches: candidate ? [candidate] : [] })
        return
      }

      if (url.pathname === '/api/v2/search/episodes') {
        if (mode === 'emptyFirstCandidate') {
          json({ animes: [
            { animeTitle: '胜者即是正义(2012)', episodes: [{ episodeId: 'empty-e2', episodeTitle: '【bilibili1】 2' }] },
            { animeTitle: '胜者即是正义(2012)', episodes: [{ episodeId: 'full-e2', episodeTitle: '【bilibili1】 2' }] }
          ] })
          return
        }
        const rows = {
          wrongEpisode: { animeTitle: '胜者即是正义(2012)', episodes: [{ episodeId: 'search-e8', episodeTitle: '第8集', episodeNumber: 8 }] },
          wrongSeason: { animeTitle: '胜者即是正义 第二季(2012)', season: 2, episodes: [{ episodeId: 'search-s2e2', episodeTitle: 'S02E02', episodeNumber: 2 }] },
          wrongTitle: { animeTitle: '完全不同的作品(2012)', episodes: [{ episodeId: 'search-wrong-title', episodeTitle: '第2集', episodeNumber: 2 }] },
          movieWrongYear: { animeTitle: '同名电影(2020)', episodes: [{ episodeId: 'search-movie-2020', episodeTitle: '正片' }] },
          specialMissingSeason: { animeTitle: '测试剧 特别篇(2026)', episodes: [{ episodeId: 'special-search-e2', episodeTitle: '第2集', episodeNumber: 2 }] },
          bareEpisodeSearch: { animeTitle: '胜者即是正义(2012)', episodes: [{ episodeId: 'bare-e2', episodeTitle: '【bilibili1】 2' }] }
        }
        json({ animes: rows[mode] ? [rows[mode]] : [] })
        return
      }

      if (url.pathname.startsWith('/api/v2/comment/')) {
        const id = decodeURIComponent(url.pathname.split('/').pop())
        if (mode === 'emptyFirstCandidate' && id === 'empty-e2') {
          json({ comments: [] })
          return
        }
        json({ comments: [{ p: '1,1,16777215,0', m: 'COMMENT_' + id }] })
        return
      }

      res.writeHead(404).end()
    })
  })

  const compatible = await listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/v2/search/episodes') {
      res.end(JSON.stringify({
        animes: [{
          animeTitle: '超时测试剧',
          episodes: [{ episodeId: 'compat-e2', episodeTitle: '第2集', episodeNumber: 2 }]
        }]
      }))
      return
    }
    if (url.pathname === '/api/v2/comment/compat-e2') {
      res.end(JSON.stringify({ comments: [{ p: '1,1,16777215,0', m: 'COMPAT_OK' }] }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })

  try {
    setLocalDanmuProviderResolver(async () => local.base)
    const config = normalizeLocalConfig({ danmaku: {} })
    const tv = { title: '胜者即是正义', originalTitle: 'リーガル・ハイ', aliases: ['Legal High'], kind: 'tv', season: 1, episode: 2, year: 2012 }

    setLocalDanmuCacheResolver(async () => ({
      animes: [{
        animeTitle: '胜者即是正义(2012)',
        episodes: [{ episodeId: 'cache-e2', episodeTitle: '【bilibili1】 2' }]
      }]
    }))
    mode = 'wrongTitle'
    let result = await resolveDanmaku({ config, media: tv, force: true })
    assert.strictEqual(result.matched, true, 'Local anime cache should provide a stable fallback before live aggregation')
    assert.strictEqual(result.episodeId, 'cache-e2')
    assert.strictEqual(result.comments[0].text, 'COMMENT_cache-e2')
    setLocalDanmuCacheResolver(null)

    mode = 'good'
    result = await resolveDanmaku({ config, media: tv, force: true })
    assert.strictEqual(result.matched, true)
    assert.strictEqual(result.episodeId, 'good-e2')

    mode = 'slowGood'
    result = await resolveDanmaku({ config, media: tv, force: true })
    assert.strictEqual(result.matched, true, 'Local /match must tolerate realistic multi-second upstream latency')
    assert.strictEqual(result.episodeId, 'slow-good-e2')

    mode = 'missingEpisode'
    result = await resolveDanmaku({ config, media: tv, force: true })
    assert.strictEqual(result.matched, false, 'Episodic /match without episode evidence must fail closed')

    mode = 'bareEpisodeSearch'
    result = await resolveDanmaku({ config, media: tv, force: true })
    assert.strictEqual(result.matched, true, 'Provider-prefixed bare episode labels must be recognized')
    assert.strictEqual(result.episodeId, 'bare-e2')

    mode = 'emptyFirstCandidate'
    result = await resolveDanmaku({ config, media: tv, force: true })
    assert.strictEqual(result.matched, true, 'An empty first candidate must not block later usable candidates from the same provider')
    assert.strictEqual(result.episodeId, 'full-e2')
    assert.strictEqual(result.comments[0].text, 'COMMENT_full-e2')

    mode = 'specialGood'
    result = await resolveDanmaku({
      config,
      media: { title: '测试剧 特别篇', kind: 'tv', season: 0, episode: 2, year: 2026 },
      force: true
    })
    assert.strictEqual(result.matched, true, 'Season 0 must preserve S00 identity')
    assert.strictEqual(result.episodeId, 'special-e2')

    for (const rejectedMode of ['wrongEpisode', 'wrongSeason', 'wrongTitle']) {
      mode = rejectedMode
      result = await resolveDanmaku({ config, media: tv, force: true })
      assert.strictEqual(result.matched, false, rejectedMode + ' must fail closed')
      assert.strictEqual(result.comments.length, 0)
    }

    mode = 'movieWrongYear'
    result = await resolveDanmaku({
      config,
      media: { title: '同名电影', kind: 'movie', year: 2024 },
      force: true
    })
    assert.strictEqual(result.matched, false, 'Explicit movie year conflict must fail closed')

    mode = 'specialMissingSeason'
    result = await resolveDanmaku({
      config,
      media: { title: '测试剧 特别篇', kind: 'tv', season: 0, episode: 2, year: 2026 },
      force: true
    })
    assert.strictEqual(result.matched, false, 'Season 0 search candidates must provide season evidence')

    mode = 'timeout'
    const fallbackConfig = normalizeLocalConfig({ danmaku: { compatibleUrls: [compatible.base] } })
    const startedAt = Date.now()
    result = await resolveDanmaku({
      config: fallbackConfig,
      media: { title: '超时测试剧', kind: 'tv', season: 1, episode: 2 },
      force: true
    })
    const elapsedMs = Date.now() - startedAt
    assert.strictEqual(result.matched, true)
    assert.strictEqual(result.provider, 'compatible-0')
    assert.strictEqual(result.episodeId, 'compat-e2')
    assert(elapsedMs < 8500, 'Fallback should be bounded; elapsed=' + elapsedMs)

    console.log('Strict danmaku matching regression tests passed')
  } finally {
    setLocalDanmuProviderResolver(null)
    setLocalDanmuCacheResolver(null)
    await Promise.all([close(local.server), close(compatible.server)])
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
