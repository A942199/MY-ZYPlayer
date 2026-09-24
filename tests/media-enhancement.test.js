'use strict'

const assert = require('assert')
const {
  DEFAULT_CONFIG,
  normalizeMediaEnhancementConfig,
  parseNumbers,
  buildMediaIdentity,
  normalizeDanmakuComments,
  allowedSubtitleCandidates,
  playlistLabel
} = require('../src/lib/player/media-enhancement')
const { romanizeKanaTitle, embeddedAllowed } = require('../src/lib/player/subtitle-controller')

function main () {
  const defaults = normalizeMediaEnhancementConfig()
  assert.strictEqual(defaults.baseUrl, DEFAULT_CONFIG.baseUrl)
  assert.strictEqual(defaults.danmakuEnabled, true)
  assert.strictEqual(defaults.subtitlesEnabled, false)
  assert.strictEqual(defaults.danmaku.opacity, 0.86)

  const clamped = normalizeMediaEnhancementConfig({
    baseUrl: ' https://example.test ',
    password: 'secret',
    danmakuEnabled: false,
    subtitlesEnabled: true,
    danmaku: { opacity: 4, fontSize: 2, speed: 999, area: 0, offset: -999 }
  })
  assert.strictEqual(clamped.baseUrl, 'https://example.test')
  assert.strictEqual(clamped.danmakuEnabled, false)
  assert.strictEqual(clamped.subtitlesEnabled, true)
  assert.deepStrictEqual(clamped.danmaku, {
    opacity: 1,
    fontSize: 16,
    speed: 280,
    area: 0.2,
    offset: -120
  })

  assert.deepStrictEqual(parseNumbers('S02E03'), { season: 2, episode: 3 })
  assert.deepStrictEqual(parseNumbers('第 7 集'), { season: null, episode: 7 })
  assert.strictEqual(playlistLabel('第三集$https://media/3.m3u8', 2), '第三集')

  const identity = buildMediaIdentity({
    videoInfo: { id: 'legal-high', name: '胜者即是正义', type: '日剧', year: 2012, index: 1 },
    detail: {
      name: '胜者即是正义',
      originalTitle: 'リーガル・ハイ',
      aliases: [{ name: 'Legal High' }, 'リーガルハイ|胜者即是正义'],
      tmdbId: '45815'
    },
    playlist: [
      '第1集$https://cdn.example/Legal.High.S01E01.1080p.m3u8',
      '第2集$https://cdn.example/Legal.High.S01E02.1080p.m3u8'
    ],
    selectedEntry: '第2集$https://cdn.example/Legal.High.S01E02.1080p.m3u8'
  })
  assert.strictEqual(identity.title, '胜者即是正义')
  assert.strictEqual(identity.originalTitle, 'リーガル・ハイ')
  assert.strictEqual(identity.kind, 'tv')
  assert.strictEqual(identity.episode, 2)
  assert.strictEqual(identity.year, 2012)
  assert.strictEqual(identity.tmdbId, '45815')
  assert(identity.aliases.includes('Legal High'))
  assert(identity.aliases.includes('リーガルハイ'))
  assert(identity.releaseHint.includes('Legal.High.S01E02'))

  const comments = normalizeDanmakuComments([
    { time: 2.5, mode: 5, color: 0xff0000, text: '顶部' },
    { progress: 1500, type: 4, color: '#00ff00', content: '底部' },
    { time: -1, text: 'invalid' },
    { time: 1, text: '滚动' }
  ])
  assert.strictEqual(comments.length, 3)
  assert.strictEqual(comments[0].text, '滚动')
  const bottom = comments.find(row => row.text === '底部')
  const top = comments.find(row => row.text === '顶部')
  assert(bottom)
  assert(top)
  assert.strictEqual(bottom.mode, 'bottom')
  assert.strictEqual(top.mode, 'top')
  assert.strictEqual(top.color, '#ff0000')

  const candidates = allowedSubtitleCandidates([
    { language: 'en', fetchUrl: '/en', fileName: 'en.vtt' },
    { language: 'ja', fetchUrl: '/ja', fileName: 'ja.vtt' },
    { language: 'ja-zh', fetchUrl: '/jazh', fileName: 'ja-zh.vtt' },
    { language: 'zh-CN', fetchUrl: '/zh', fileName: 'zh.vtt' },
    { language: 'ja', fetchUrl: '', fileName: 'missing.vtt' }
  ])
  assert.deepStrictEqual(candidates.map(row => row.language), ['ja', 'ja-zh'])

  assert.strictEqual(romanizeKanaTitle('りーがる はい'), 'Riigaru Hai')
  assert.strictEqual(romanizeKanaTitle('きょう'), 'Kyou')
  assert.strictEqual(embeddedAllowed({ language: 'ja', label: '日本語' }), true)
  assert.strictEqual(embeddedAllowed({ language: 'en', label: 'English' }), false)

  console.log('Media enhancement unit tests passed')
}

main()
