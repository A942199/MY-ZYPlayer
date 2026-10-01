'use strict'

const assert = require('assert')
const {
  normalizeMediaEnhancementConfig
} = require('../src/lib/player/media-enhancement')
const {
  mergeProviderSecrets
} = require('../src/main/media-enhancement/runtime')

const raw = {
  providers: {
    danmaku: {
      dandanplayAppId: 'app',
      dandanplayAppSecret: 'secret',
      compatibleUrls: ['https://example.com'],
      compatibleToken: 'token'
    },
    subtitles: {
      jimakuApiKey: 'jimaku',
      assrtApiToken: 'assrt',
      openSubtitlesApiKey: 'open',
      openSubtitlesUserAgent: 'UA',
      subdlApiKey: 'subdl'
    }
  }
}

const renderer = normalizeMediaEnhancementConfig(raw)
assert.strictEqual(Object.prototype.hasOwnProperty.call(renderer.providers.danmaku, 'dandanplayAppSecret'), false)
assert.strictEqual(Object.prototype.hasOwnProperty.call(renderer.providers.danmaku, 'compatibleToken'), false)
assert.strictEqual(Object.prototype.hasOwnProperty.call(renderer.providers.subtitles, 'jimakuApiKey'), false)
assert.strictEqual(Object.prototype.hasOwnProperty.call(renderer.providers.subtitles, 'assrtApiToken'), false)
assert.strictEqual(Object.prototype.hasOwnProperty.call(renderer.providers.subtitles, 'openSubtitlesApiKey'), false)
assert.strictEqual(Object.prototype.hasOwnProperty.call(renderer.providers.subtitles, 'subdlApiKey'), false)
assert.strictEqual(renderer.providers.danmaku.dandanplayAppId, 'app')
assert.deepStrictEqual(renderer.providers.danmaku.compatibleUrls, ['https://example.com'])
assert.strictEqual(renderer.providers.subtitles.openSubtitlesUserAgent, 'UA')

const merged = mergeProviderSecrets(renderer.providers, {
  dandanplayAppSecret: 'secret',
  compatibleToken: 'token',
  jimakuApiKey: 'jimaku',
  assrtApiToken: 'assrt',
  openSubtitlesApiKey: 'open',
  subdlApiKey: 'subdl'
})
assert.strictEqual(merged.danmaku.dandanplayAppSecret, 'secret')
assert.strictEqual(merged.danmaku.compatibleToken, 'token')
assert.strictEqual(merged.subtitles.jimakuApiKey, 'jimaku')
assert.strictEqual(merged.subtitles.assrtApiToken, 'assrt')
assert.strictEqual(merged.subtitles.openSubtitlesApiKey, 'open')
assert.strictEqual(merged.subtitles.subdlApiKey, 'subdl')
assert.strictEqual(renderer.providers.danmaku.dandanplayAppSecret, undefined)

const fs = require('fs')
const preloadText = fs.readFileSync(require('path').resolve(__dirname, '../src/preload.js'), 'utf8')
assert.strictEqual(/readProviderSecrets|readSecrets|readForMainProcess/.test(preloadText), false)

console.log('Settings secret IPC boundary tests passed')
