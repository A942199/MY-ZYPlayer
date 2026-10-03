'use strict'

const assert = require('assert')
const http = require('http')
const { scoreIdentity, normalizeTitle, identityKey, seasonValue, episodeValue, genericEpisodeLabel } = require('../src/lib/douban/identity')
const { sortSubjectsForDisplay } = require('../src/lib/douban/sort')
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
  const rankedSubjects = sortSubjectsForDisplay([
    { id: 'a', title: 'A', rate: '8.9' },
    { id: 'b', title: 'B', rate: '9.2' },
    { id: 'c', title: 'C', rate: '' },
    { id: 'd', title: 'D', rate: '9.2' },
    { id: 'e', title: 'E', rate: 'not-rated' },
    { id: 'f', title: 'F', rate: '9.4' }
  ], 'rank')
  assert.deepStrictEqual(rankedSubjects.map(item => item.id), ['f', 'b', 'd', 'a', 'c', 'e'])

  const upstreamOrder = [
    { id: 'a', rate: '8.9' },
    { id: 'b', rate: '9.4' }
  ]
  assert.deepStrictEqual(sortSubjectsForDisplay(upstreamOrder, 'recommend').map(item => item.id), ['a', 'b'])
  assert.deepStrictEqual(sortSubjectsForDisplay(upstreamOrder, 'time').map(item => item.id), ['a', 'b'])

  assert.strictEqual(normalizeTitle(' 白色巨塔 / Season 1 '), '白色巨塔')
  assert.notStrictEqual(
    identityKey({ id: '111', title: '同名电影', year: 2024, kind: 'movie' }),
    identityKey({ id: '222', title: '同名电影', year: 2024, kind: 'movie' }),
    'Different Douban subject ids must not share scan/cache identity'
  )
  assert.strictEqual(
    identityKey({ id: 'tv-1', title: '同一剧', year: 2024, kind: 'tv', season: 1, episode: 1 }),
    identityKey({ id: 'tv-1', title: '同一剧', year: 2024, kind: 'tv', season: 1, episode: 9 }),
    'Source matching must be cached per work/season, not per episode'
  )

  const animatedMovie = scoreIdentity(
    { title: '千与千寻', year: 2001, kind: 'movie' },
    { name: '千与千寻', year: 2001 },
    { name: '千与千寻', year: 2001, type: '动画片', fullList: [{ flag: '正片', list: ['正片$https://example.invalid/movie.mp4'] }] }
  )
  assert.strictEqual(animatedMovie.accepted, true, 'Animation alone must not force a movie candidate to TV')
  assert(animatedMovie.accuracy >= 85)

  const aliasOnlyMatch = scoreIdentity(
    { title: '胜者即是正义', originalTitle: 'リーガル・ハイ', year: 2012, kind: 'tv' },
    { name: 'Legal High', year: 2012 },
    { name: 'Legal High', originalTitle: 'リーガル・ハイ', year: 2012, kind: 'tv', fullList: [{ flag: 'line', list: ['第01集$https://example.invalid/1.m3u8'] }] }
  )
  assert.strictEqual(aliasOnlyMatch.accepted, true, 'Provider original title/aliases must participate in title identity matching')
  assert(aliasOnlyMatch.reasons.includes('title_exact'))
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
  assert.strictEqual(exactOnly.score, 82)
  assert.strictEqual(exactOnly.accepted, false)

  const exactKind = scoreIdentity(identity, { name: '白色巨塔' }, { name: '白色巨塔', kind: 'tv' })
  assert.strictEqual(exactKind.accepted, true, 'Exact title plus matching media kind must survive sparse provider metadata')

  const exactDirector = scoreIdentity(identity, { name: '白色巨塔' }, { name: '白色巨塔', director: '西谷弘' })
  assert.strictEqual(exactDirector.accepted, true, 'Exact title plus matching director must survive sparse provider metadata')

  const exactCast = scoreIdentity(identity, { name: '白色巨塔' }, { name: '白色巨塔', actor: '唐泽寿明' })
  assert.strictEqual(exactCast.accepted, true, 'Exact title plus matching cast must survive sparse provider metadata')

  const sparseMoviePlayback = scoreIdentity(
    { title: '肖申克的救赎', year: 1994, kind: 'movie' },
    { name: '肖申克的救赎' },
    { name: '肖申克的救赎', fullList: [{ flag: '默认分组', list: ['HD$https://example.invalid/movie.m3u8'] }] }
  )
  assert.strictEqual(sparseMoviePlayback.accepted, true, 'Exact movie title plus non-episodic movie playback shape must survive sparse provider metadata')
  assert(sparseMoviePlayback.reasons.includes('movie_playback_shape'))

  const sparseTvPlayback = scoreIdentity(
    { title: '同名剧', year: 2024, kind: 'tv' },
    { name: '同名剧' },
    { name: '同名剧', fullList: [{ flag: '默认分组', list: ['HD$https://example.invalid/one.m3u8'] }] }
  )
  assert.strictEqual(sparseTvPlayback.accepted, false, 'A single HD track must not make sparse TV metadata pass as a work match')

  const mixedEpisodicMovieShape = scoreIdentity(
    { title: '同名作品', year: 2024, kind: 'movie' },
    { name: '同名作品' },
    { name: '同名作品', fullList: [{ flag: '默认分组', list: ['HD$https://example.invalid/a.m3u8', '第01集$https://example.invalid/b.m3u8'] }] }
  )
  assert.strictEqual(mixedEpisodicMovieShape.accepted, false, 'One movie-like label must not outweigh equally strong episodic evidence')

  const exactYear = scoreIdentity(identity, { name: '白色巨塔', year: 2003 }, {
    name: '白色巨塔',
    year: 2003,
    fullList: [{ flag: '线路', list: ['第01集$https://example.invalid/1.m3u8', '第02集$https://example.invalid/2.m3u8'] }]
  })
  assert(exactYear.score >= 85)
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

  const differentEpisodeDoesNotChangeWorkMatch = scoreIdentity(
    { ...identity, episode: 1 },
    { name: '白色巨塔', year: 2003, episode: 2 },
    { name: '白色巨塔', year: 2003, kind: 'tv', episode: 2 }
  )
  assert.strictEqual(differentEpisodeDoesNotChangeWorkMatch.accepted, true)
  assert(!differentEpisodeDoesNotChangeWorkMatch.reasons.includes('episode_mismatch'))

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

  const unknownMovieIdentityMustNotAcceptTvOnTitleYearAlone = scoreIdentity(
    { title: '同名作品', year: 2024, kind: 'unknown' },
    { name: '同名作品', year: 2024 },
    { name: '同名作品', year: 2024, kind: 'tv' }
  )
  assert.strictEqual(unknownMovieIdentityMustNotAcceptTvOnTitleYearAlone.accepted, false)

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

  await new Promise((resolve, reject) => {
    let leakedAuthorization = ''
    const target = http.createServer((req, res) => {
      leakedAuthorization = req.headers.authorization || ''
      res.writeHead(206, { 'Content-Type': 'video/mp4' })
      res.end(Buffer.from('x'))
    })
    target.listen(0, '127.0.0.1', () => {
      const redirect = http.createServer((req, res) => {
        res.writeHead(302, { Location: 'http://127.0.0.1:' + target.address().port + '/video.mp4' })
        res.end()
      })
      redirect.listen(0, '127.0.0.1', async () => {
        try {
          const redirected = await probeUrl({
            url: 'http://127.0.0.1:' + redirect.address().port + '/start',
            headers: [{ name: 'Authorization', value: 'Bearer secret' }]
          })
          assert.strictEqual(redirected.ok, true)
          assert.strictEqual(leakedAuthorization, '', 'Cross-origin redirects must strip Authorization')
          redirect.close(() => target.close(resolve))
        } catch (error) {
          redirect.close(() => target.close(() => reject(error)))
        }
      })
    })
  })

  await withServer((req, res) => {
    if (req.url === '/master.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=16000000,RESOLUTION=3840x2160\n/bad.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=8000000,RESOLUTION=1920x1080\n/good.m3u8\n')
      return
    }
    if (req.url === '/bad.m3u8') {
      res.writeHead(404)
      res.end()
      return
    }
    if (req.url === '/good.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' })
      res.end('#EXTM3U\n#EXTINF:4,\n/good.ts\n')
      return
    }
    if (req.url === '/good.ts') {
      res.writeHead(206, { 'Content-Type': 'video/mp2t' })
      res.end(Buffer.alloc(188, 0x47))
      return
    }
    res.writeHead(404)
    res.end()
  }, async port => {
    const hls = await probeUrl({ url: 'http://127.0.0.1:' + port + '/master.m3u8' })
    assert.strictEqual(hls.ok, true, 'HLS probing should try later variants when the first variant fails')
    assert(hls.fragmentUrl.endsWith('/good.ts'))
    assert.strictEqual(hls.width, 1920)
    assert.strictEqual(hls.height, 1080)
    assert.strictEqual(hls.bandwidth, 8000000)
  })

  console.log('Douban identity and playback probe tests passed')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
