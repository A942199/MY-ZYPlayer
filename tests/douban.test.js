'use strict'

const assert = require('assert')
const http = require('http')
const { scoreIdentity, normalizeTitle, identityKey, seasonValue, episodeValue, genericEpisodeLabel } = require('../src/lib/douban/identity')
const { subjectDetail, fetchImageData, probeUrl } = require('../src/main/douban/runtime')

async function withServer (handler, run) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    return await run(server.address().port)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function main () {
  assert.strictEqual(normalizeTitle(' 白色巨塔 / Season 1 '), '白色巨塔')
  assert.strictEqual(identityKey({ id: '1', title: '白色巨塔', year: 2003, kind: 'tv' }), 'v2|tv||白色巨塔|2003||')
  assert.strictEqual(identityKey({ title: '白色巨塔', year: 2003, kind: 'tv', tmdbId: 123, season: 2, episode: 3 }), 'v2|tv|123|白色巨塔|2003|2|3')
  assert.strictEqual(seasonValue({ title: '白色巨塔 第2季' }), 2)
  assert.strictEqual(episodeValue({ episodeIndex: 0 }), 1)
  assert.strictEqual(episodeValue({ episodeLabel: '第02集' }), 2)
  assert.strictEqual(genericEpisodeLabel('立即播放'), true)
  assert.strictEqual(genericEpisodeLabel('Watch Now'), true)
  assert.strictEqual(genericEpisodeLabel('第01集'), false)

  const identity = {
    title: '白色巨塔',
    aliases: ['The Great White Tower'],
    year: 2003,
    kind: 'tv',
    directors: ['西谷弘'],
    casts: ['唐泽寿明']
  }

  const exactOnly = scoreIdentity(
    { ...identity, year: null, directors: [], casts: [], kind: 'unknown' },
    { name: '白色巨塔' },
    { name: '白色巨塔' }
  )
  assert.strictEqual(exactOnly.score, 90)
  assert.strictEqual(exactOnly.accepted, false)

  const exactYear = scoreIdentity(identity, { name: '白色巨塔', year: 2003 }, {
    name: '白色巨塔',
    year: 2003,
    fullList: [{ flag: '线路', list: ['第01集$https://example.invalid/1.m3u8', '第02集$https://example.invalid/2.m3u8'] }]
  })
  assert(exactYear.score >= 100)
  assert.strictEqual(exactYear.accepted, true)

  const wrongYear = scoreIdentity(identity, { name: '白色巨塔', year: 2019 }, { name: '白色巨塔', year: 2019 })
  assert.strictEqual(wrongYear.accepted, false)
  assert(wrongYear.reasons.includes('year_mismatch'))

  const wrongKind = scoreIdentity(identity, { name: '白色巨塔', year: 2003 }, {
    name: '白色巨塔',
    year: 2003,
    kind: 'movie'
  })
  assert.strictEqual(wrongKind.accepted, false)
  assert(wrongKind.reasons.includes('kind_mismatch'))

  const wrongTmdb = scoreIdentity(
    { ...identity, tmdbId: '111' },
    { name: '白色巨塔', year: 2003, tmdbId: '222' },
    { name: '白色巨塔', year: 2003, tmdbId: '222', kind: 'tv' }
  )
  assert.strictEqual(wrongTmdb.accepted, false)
  assert(wrongTmdb.reasons.includes('tmdb_mismatch'))

  const wrongSeason = scoreIdentity(
    { ...identity, season: 2 },
    { name: '白色巨塔', year: 2003, season: 1 },
    { name: '白色巨塔', year: 2003, season: 1, kind: 'tv' }
  )
  assert.strictEqual(wrongSeason.accepted, false)
  assert(wrongSeason.reasons.includes('season_mismatch'))

  const wrongEpisode = scoreIdentity(
    { ...identity, episode: 1 },
    { name: '白色巨塔', year: 2003, episode: 2 },
    { name: '白色巨塔', year: 2003, kind: 'tv', episode: 2 }
  )
  assert.strictEqual(wrongEpisode.accepted, false)
  assert(wrongEpisode.reasons.includes('episode_mismatch'))

  const unclearSeasonDoesNotConflict = scoreIdentity(
    { ...identity, season: 2 },
    { name: '白色巨塔', year: 2003 },
    { name: '白色巨塔', year: 2003, kind: 'tv' }
  )
  assert.strictEqual(unclearSeasonDoesNotConflict.accepted, true)

  const animationMovieConflict = scoreIdentity(
    { title: '进击的巨人', year: 2026, kind: 'tv' },
    { name: '进击的巨人', year: 2026 },
    { name: '进击的巨人', year: 2026, kind: 'movie', type: '动画电影' }
  )
  assert.strictEqual(animationMovieConflict.accepted, false)
  assert(animationMovieConflict.reasons.includes('kind_mismatch'))

  const genericEpisodeDoesNotConflict = scoreIdentity(
    { ...identity, episodeIndex: 0 },
    { name: '白色巨塔', year: 2003 },
    { name: '白色巨塔', year: 2003, kind: 'tv', episodeLabel: '立即播放' }
  )
  assert.strictEqual(genericEpisodeDoesNotConflict.accepted, true)

  const detailHtml = [
    '<html><body>',
    '<span property="v:itemreviewed">胜者即是正义</span>',
    '<span class="year">(2012)</span>',
    '<strong property="v:average">9.4</strong>',
    '<div id="mainpic"><img src="https://img.invalid/legal-high.jpg"></div>',
    '<div id="info">原名: リーガル・ハイ\\n又名: Legal High / 胜者即是正义\\n制片国家/地区: 日本\\n语言: 日语\\n集数: 11</div>',
    '<a rel="v:directedBy">石川淳一</a>',
    '<a rel="v:starring">堺雅人</a>',
    '<span property="v:genre">剧情</span>',
    '<span property="v:summary"> 法庭 喜剧 </span>',
    '</body></html>'
  ].join('')

  const fullDetail = await subjectDetail(
    { id: '10491666', title: '胜者即是正义', kind: 'tv', cover: 'fallback.jpg', rate: '9.4' },
    {
      requestText: async () => ({ status: 200, text: detailHtml }),
      subjectFingerprint: async () => ({ year: 2012, originalTitle: 'リーガル・ハイ', director: '石川淳一', cast: '堺雅人', text: 'fingerprint' })
    }
  )
  assert.strictEqual(fullDetail.detailStatus, 'full')
  assert.strictEqual(fullDetail.year, 2012)
  assert.strictEqual(fullDetail.kind, 'tv')
  assert(fullDetail.directors.includes('石川淳一'))
  assert(fullDetail.casts.includes('堺雅人'))

  const partialDetail = await subjectDetail(
    { id: '10491666', title: '胜者即是正义', kind: 'tv', cover: 'fallback.jpg', rate: '9.4' },
    {
      requestText: async () => { throw new Error('Request timed out') },
      subjectFingerprint: async () => ({ year: 2012, originalTitle: 'リーガル・ハイ', director: '石川淳一', cast: '堺雅人', text: 'fingerprint' })
    }
  )
  assert.strictEqual(partialDetail.detailStatus, 'partial')
  assert.strictEqual(partialDetail.year, 2012)
  assert.strictEqual(partialDetail.originalTitle, 'リーガル・ハイ')
  assert.strictEqual(partialDetail.detailError, 'Request timed out')

  const degradedDetail = await subjectDetail(
    { id: '10491666', title: '胜者即是正义', kind: 'tv', cover: 'fallback.jpg', rate: '9.4' },
    {
      requestText: async () => { throw new Error('Request timed out') },
      subjectFingerprint: async () => { throw new Error('Search unavailable') }
    }
  )
  assert.strictEqual(degradedDetail.detailStatus, 'degraded')
  assert.strictEqual(degradedDetail.title, '胜者即是正义')
  assert.strictEqual(degradedDetail.kind, 'tv')
  assert.strictEqual(degradedDetail.cover, 'fallback.jpg')
  assert.strictEqual(degradedDetail.detailError, 'Request timed out')

  await withServer((req, res) => {
    if (req.url === '/direct.mp4') {
      const data = Buffer.from('fake-video-bytes')
      res.writeHead(req.headers.range ? 206 : 200, {
        'Content-Type': 'video/mp4',
        'Content-Length': data.length,
        'Accept-Ranges': 'bytes'
      })
      res.end(data)
      return
    }
    if (req.url === '/master.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\n/media.m3u8\n')
      return
    }
    if (req.url === '/media.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXTINF:4,\n/seg.ts\n#EXT-X-ENDLIST\n')
      return
    }
    if (req.url === '/seg.ts') {
      res.writeHead(req.headers.range ? 206 : 200, { 'Content-Type': 'video/mp2t' })
      res.end(Buffer.alloc(188, 0x47))
      return
    }
    res.writeHead(404)
    res.end()
  }, async port => {
    const direct = await probeUrl({ url: 'http://127.0.0.1:' + port + '/direct.mp4' })
    assert.strictEqual(direct.ok, true)
    assert.strictEqual(direct.kind, 'direct')

    const hls = await probeUrl({ url: 'http://127.0.0.1:' + port + '/master.m3u8' })
    assert.strictEqual(hls.ok, true)
    assert.strictEqual(hls.kind, 'hls')
    assert(hls.fragmentUrl.endsWith('/seg.ts'))
  })

  await withServer((req, res) => {
    if (req.url === '/cover.jpg') {
      const data = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length })
      res.end(data)
      return
    }
    res.writeHead(404)
    res.end()
  }, async port => {
    const image = await fetchImageData({ url: 'http://127.0.0.1:' + port + '/cover.jpg' })
    assert.strictEqual(image.contentType, 'image/jpeg')
    assert(image.dataUrl.startsWith('data:image/jpeg;base64,'))
  })

  console.log('Douban identity and playback probe tests passed')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
