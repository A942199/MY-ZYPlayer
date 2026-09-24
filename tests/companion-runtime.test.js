'use strict'

const assert = require('assert')
const http = require('http')
const {
  normalizeCompanionConfig,
  resolveDanmaku,
  resolveSubtitles,
  fetchSubtitle
} = require('../src/main/media-enhancement/runtime')

function startServer () {
  return new Promise(resolve => {
    const stats = { requests: [], auth: [] }
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      stats.requests.push(url.pathname + url.search)
      stats.auth.push(String(req.headers['x-password'] || ''))

      if (req.headers['x-password'] !== 'e2e-secret') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'site_unauthorized' }))
        return
      }

      if (url.pathname === '/myvideo/api/danmaku/resolve' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          const parsed = JSON.parse(body)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            enabled: true,
            matched: true,
            provider: 'e2e',
            providerName: 'E2E Danmaku',
            episode: parsed.episode,
            comments: [
              { time: 0.1, mode: 'scroll', color: '#ffffff', text: 'テスト弾幕' }
            ]
          }))
        })
        return
      }

      if (url.pathname === '/myvideo/api/subtitles/resolve' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          autoSelectIndex: 1,
          candidates: [
            { provider: 'e2e', providerRef: 'en', language: 'en', label: 'English', fileName: 'en.vtt', fetchUrl: '/api/subtitles/fetch?key=k&provider=e2e&ref=en' },
            { provider: 'e2e', providerRef: 'ja', language: 'ja', label: '日本語', fileName: 'ja.vtt', fetchUrl: '/api/subtitles/fetch?key=k&provider=e2e&ref=ja' },
            { provider: 'e2e', providerRef: 'zh', language: 'zh-CN', label: '中文', fileName: 'zh.vtt', fetchUrl: '/api/subtitles/fetch?key=k&provider=e2e&ref=zh' }
          ]
        }))
        return
      }

      if (url.pathname === '/myvideo/api/subtitles/fetch' && req.method === 'GET') {
        const text = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.800\nテスト字幕\n'
        res.writeHead(200, {
          'Content-Type': 'text/vtt;charset=UTF-8',
          'X-Subtitle-Language': 'ja',
          'Content-Length': Buffer.byteLength(text)
        })
        res.end(text)
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
  const port = server.address().port
  const config = {
    baseUrl: 'http://127.0.0.1:' + port + '/myvideo',
    password: 'e2e-secret'
  }

  try {
    const normalized = normalizeCompanionConfig(config)
    assert.strictEqual(normalized.baseUrl, config.baseUrl)

    const danmaku = await resolveDanmaku({
      config,
      media: { title: '胜者即是正义', kind: 'tv', year: 2012, season: 1, episode: 2 }
    })
    assert.strictEqual(danmaku.matched, true)
    assert.strictEqual(danmaku.providerName, 'E2E Danmaku')
    assert.strictEqual(danmaku.comments.length, 1)

    const subtitles = await resolveSubtitles({
      config,
      media: { title: '胜者即是正义', originalTitle: 'リーガル・ハイ', kind: 'tv', season: 1, episode: 2 }
    })
    assert.deepStrictEqual(subtitles.candidates.map(row => row.language), ['ja'])
    assert.strictEqual(subtitles.autoSelectIndex, 0)

    assert.strictEqual(subtitles.candidates[0].fetchUrl, '/api/subtitles/fetch?key=k&provider=e2e&ref=ja')
    const subtitle = await fetchSubtitle({
      config,
      fetchUrl: subtitles.candidates[0].fetchUrl
    })
    assert(subtitle.text.startsWith('WEBVTT'))
    assert(subtitle.text.includes('テスト字幕'))
    assert.strictEqual(subtitle.language, 'ja')
    assert(stats.requests.some(value => value.startsWith('/myvideo/api/subtitles/fetch?')))
    assert(stats.auth.every(value => value === 'e2e-secret'))

    await assert.rejects(
      fetchSubtitle({ config, fetchUrl: 'https://evil.example/api/subtitles/fetch?x=1' }),
      /不可信/
    )

    await assert.rejects(
      resolveDanmaku({ config: { ...config, password: 'wrong' }, media: { title: '测试' } }),
      /认证失败/
    )

    console.log('Companion subtitle/danmaku runtime tests passed')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
