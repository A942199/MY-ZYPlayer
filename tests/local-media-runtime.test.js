'use strict'

const assert = require('assert')
const http = require('http')
const {
  normalizeLocalConfig,
  resolveDanmaku,
  resolveSubtitles,
  fetchSubtitle,
  classifySubtitleMetadata,
  classifySubtitleContent
} = require('../src/main/media-enhancement/runtime')

function startServer () {
  return new Promise(resolve => {
    const stats = { requests: [], dandanAuth: [], jimakuAuth: [] }
    const server = http.createServer((req, res) => {
      const origin = 'http://127.0.0.1:' + server.address().port
      const url = new URL(req.url, origin)
      stats.requests.push(url.pathname + url.search)

      if (url.pathname === '/api/v2/search/episodes') {
        stats.dandanAuth.push([req.headers['x-appid'] || '', req.headers['x-appsecret'] || ''])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          animes: [{
            animeId: 'legal-high',
            animeTitle: '胜者即是正义',
            episodes: [{ episodeId: 'legal-high-2', episodeNumber: 2, episodeTitle: '第2集' }]
          }]
        }))
        return
      }
      if (url.pathname === '/api/v2/comment/legal-high-2') {
        stats.dandanAuth.push([req.headers['x-appid'] || '', req.headers['x-appsecret'] || ''])
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          comments: [
            { time: 0.1, mode: 1, color: 0xffffff, text: 'テスト弾幕' },
            { time: 0.2, mode: 5, color: 0xffcc00, text: 'トップ' }
          ]
        }))
        return
      }
      if (url.pathname === '/api/entries/search') {
        stats.jimakuAuth.push(req.headers.authorization || '')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([{
          id: '10',
          japanese_name: 'リーガル・ハイ',
          english_name: 'Legal High',
          tmdb_id: 'tv:45815'
        }]))
        return
      }
      if (url.pathname === '/api/entries/10/files') {
        stats.jimakuAuth.push(req.headers.authorization || '')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([
          { name: 'Legal.High.S01E02.JA.vtt', url: origin + '/subtitle-ja.vtt' },
          { name: 'Legal.High.S01E02.EN.vtt', url: origin + '/subtitle-en.vtt' }
        ]))
        return
      }
      if (url.pathname === '/subtitle-ja.vtt') {
        stats.jimakuAuth.push(req.headers.authorization || '')
        const body = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nこれはテスト字幕です\n'
        res.writeHead(200, { 'Content-Type': 'text/vtt;charset=UTF-8', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
        return
      }
      if (url.pathname === '/subtitle-en.vtt') {
        const body = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nThis is an English subtitle line\n'
        res.writeHead(200, { 'Content-Type': 'text/vtt;charset=UTF-8', 'Content-Length': Buffer.byteLength(body) })
        res.end(body)
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not_found' }))
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, stats }))
  })
}

async function main () {
  const { server, stats } = await startServer()
  const base = 'http://127.0.0.1:' + server.address().port
  const config = {
    providers: {
      dandanplay: { appId: 'app-id', appSecret: 'app-secret', baseUrl: base },
      jimaku: { apiKey: 'jimaku-key', baseUrl: base },
      assrt: { token: '' },
      opensubtitles: { apiKey: '', userAgent: 'MY-ZYPlayer test' },
      subdl: { apiKey: '' },
      compatibleDanmaku: { urls: '', token: '' }
    }
  }

  try {
    const normalized = normalizeLocalConfig(config)
    assert.strictEqual(normalized.providers.dandanplay.appId, 'app-id')
    assert.strictEqual(normalized.providers.jimaku.apiKey, 'jimaku-key')
    assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized, 'baseUrl'), false)

    const media = {
      title: '胜者即是正义',
      originalTitle: 'リーガル・ハイ',
      aliases: ['Legal High'],
      tmdbId: '45815',
      kind: 'tv',
      year: 2012,
      season: 1,
      episode: 2
    }

    const danmaku = await resolveDanmaku({ config, media })
    assert.strictEqual(danmaku.local, true)
    assert.strictEqual(danmaku.matched, true)
    assert.strictEqual(danmaku.provider, 'dandanplay')
    assert.strictEqual(danmaku.comments.length, 2)
    assert(stats.dandanAuth.every(row => row[0] === 'app-id' && row[1] === 'app-secret'))

    const subtitles = await resolveSubtitles({ config, media })
    assert.strictEqual(subtitles.local, true)
    assert.strictEqual(subtitles.candidates.length, 1)
    assert.strictEqual(subtitles.candidates[0].provider, 'jimaku')
    assert.strictEqual(subtitles.candidates[0].language, 'ja')
    assert(/^local-subtitle:\/\//.test(subtitles.candidates[0].fetchUrl))
    assert(stats.jimakuAuth.every(value => value === 'jimaku-key'))

    const subtitle = await fetchSubtitle({ config, fetchUrl: subtitles.candidates[0].fetchUrl })
    assert(subtitle.text.startsWith('WEBVTT'))
    assert(subtitle.text.includes('これはテスト字幕です'))
    assert.strictEqual(subtitle.language, 'ja')

    assert.strictEqual(classifySubtitleMetadata('ja', 'episode.vtt'), 'ja')
    assert.strictEqual(classifySubtitleMetadata('en', 'episode.vtt'), 'en')
    assert.strictEqual(classifySubtitleContent('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nこれは日本語です'), 'ja')

    await assert.rejects(
      fetchSubtitle({ config, fetchUrl: 'https://video.zi-quan.com/api/subtitles/fetch' }),
      /subtitle_reference_invalid/
    )

    const noProviders = await resolveDanmaku({ config: { providers: {} }, media })
    assert.strictEqual(noProviders.enabled, false)
    const noSubtitles = await resolveSubtitles({ config: { providers: {} }, media, force: true })
    assert.strictEqual(noSubtitles.candidates.length, 0)

    assert.strictEqual(stats.requests.some(value => value.startsWith('/api/v2/search/episodes')), true)
    assert.strictEqual(stats.requests.some(value => value.startsWith('/api/entries/search')), true)
    assert.strictEqual(stats.requests.some(value => value.startsWith('/subtitle-ja.vtt')), true)
    assert.strictEqual(stats.requests.some(value => value.includes('/myvideo/')), false)

    console.log('Local subtitle/danmaku provider runtime tests passed')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
