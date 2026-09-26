'use strict'

const assert = require('assert')
const http = require('http')
const {
  normalizeLocalConfig,
  resolveDanmaku,
  resolveSubtitles,
  fetchSubtitle,
  setLocalDanmuProviderResolver
} = require('../src/main/media-enhancement/runtime')

function startServer () {
  return new Promise(resolve => {
    const stats = { danmakuMatch: 0, danmakuSearch: 0, danmakuComments: 0, jimakuSearch: 0, jimakuFiles: 0, subtitleFetch: 0 }
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname === '/api/v2/match' && req.method === 'POST') {
        stats.danmakuMatch++
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          const input = JSON.parse(body || '{}')
          assert(String(input.fileName || '').includes('S01E02'))
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ isMatched: true, matches: [{ animeTitle: 'リーガル・ハイ(2012)', episodeId: 'e2', episodeTitle: 'S01E02', year: 2012 }] }))
        })
        return
      }
      if (url.pathname === '/api/v2/search/episodes') {
        stats.danmakuSearch++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ animes: [{ animeTitle: '胜者即是正义', episodes: [{ episodeId: 'e2', episodeTitle: '第2集', episodeNumber: 2 }] }] }))
        return
      }
      if (url.pathname === '/api/v2/comment/e2') {
        stats.danmakuComments++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ comments: [{ p: '0.2,1,16777215,0,0,0,0,0', m: '本地弹幕' }] }))
        return
      }
      if (url.pathname === '/api/entries/search') {
        stats.jimakuSearch++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify([{ id: 88, name: '胜者即是正义' }]))
        return
      }
      if (url.pathname === '/api/entries/88/files') {
        stats.jimakuFiles++
        const base = 'http://127.0.0.1:' + server.address().port
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify([{ name: 'Legal.High.S01E02.Japanese.vtt', language: 'ja', url: base + '/subtitle.vtt' }]))
        return
      }
      if (url.pathname === '/subtitle.vtt') {
        stats.subtitleFetch++
        const text = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nテスト字幕です\n'
        res.writeHead(200, { 'content-type': 'text/vtt', 'content-length': Buffer.byteLength(text) })
        res.end(text)
        return
      }
      res.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, stats }))
  })
}

async function main () {
  const { server, stats } = await startServer()
  const base = 'http://127.0.0.1:' + server.address().port
  const config = normalizeLocalConfig({
    danmaku: {},
    subtitles: { jimakuApiKey: 'local-test', jimakuBaseUrl: base }
  })
  try {
    setLocalDanmuProviderResolver(async () => base)
    const media = { title: '胜者即是正义', originalTitle: 'リーガル・ハイ', aliases: ['Legal High'], kind: 'tv', season: 1, episode: 2, year: 2012 }
    const danmaku = await resolveDanmaku({ config, media })
    assert.strictEqual(danmaku.matched, true)
    assert.strictEqual(danmaku.provider, 'local-danmu-api')
    assert.strictEqual(danmaku.comments.length, 1)
    assert.strictEqual(danmaku.comments[0].text, '本地弹幕')

    const titleFallback = await resolveDanmaku({
      config,
      media: { originalTitle: 'リーガル・ハイ', aliases: ['Legal High'], kind: 'tv', season: 1, episode: 2, year: 2012 },
      force: true
    })
    assert.strictEqual(titleFallback.matched, true)

    const subtitles = await resolveSubtitles({ config, media })
    assert.strictEqual(subtitles.candidates.length, 1)
    assert.strictEqual(subtitles.candidates[0].provider, 'jimaku')
    assert.strictEqual(subtitles.candidates[0].language, 'ja')
    assert(/^local-subtitle:\/\//.test(subtitles.candidates[0].fetchUrl))

    const subtitle = await fetchSubtitle({ config, fetchUrl: subtitles.candidates[0].fetchUrl })
    assert(subtitle.text.startsWith('WEBVTT'))
    assert.strictEqual(subtitle.language, 'ja')
    assert(stats.danmakuMatch > 0 && stats.danmakuComments > 0)
    assert(stats.jimakuSearch > 0 && stats.jimakuFiles > 0 && stats.subtitleFetch > 0)
    console.log('Local subtitle/danmaku provider runtime tests passed')
  } finally {
    setLocalDanmuProviderResolver(null)
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
