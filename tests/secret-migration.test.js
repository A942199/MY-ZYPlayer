'use strict'

const assert = require('assert')
const {
  buildLegacySecretClearPatch,
  extractLegacySecrets,
  migrateLegacySecrets,
  stripLegacySecrets
} = require('../src/main/settings/secret-migration')

function legacySettings () {
  return {
    id: 0,
    theme: 'dark',
    mediaEnhancement: {
      danmakuEnabled: true,
      providers: {
        danmaku: {
          dandanplayAppId: 'app-id',
          dandanplayAppSecret: 'dandan-secret',
          compatibleUrls: ['https://example.com'],
          compatibleToken: 'bearer-secret'
        },
        subtitles: {
          jimakuApiKey: 'jimaku-secret',
          assrtApiToken: 'assrt-secret',
          openSubtitlesApiKey: 'open-secret',
          openSubtitlesUserAgent: 'MY-ZYPlayer v2.9',
          subdlApiKey: 'subdl-secret'
        }
      }
    }
  }
}

async function main () {
  const settings = legacySettings()
  assert.deepStrictEqual(extractLegacySecrets(settings), {
    dandanplayAppSecret: 'dandan-secret',
    compatibleToken: 'bearer-secret',
    jimakuApiKey: 'jimaku-secret',
    assrtApiToken: 'assrt-secret',
    openSubtitlesApiKey: 'open-secret',
    subdlApiKey: 'subdl-secret'
  })

  const stripped = stripLegacySecrets(settings)
  assert.strictEqual(stripped.mediaEnhancement.providers.danmaku.dandanplayAppSecret, '')
  assert.strictEqual(stripped.mediaEnhancement.providers.danmaku.compatibleToken, '')
  assert.strictEqual(stripped.mediaEnhancement.providers.subtitles.jimakuApiKey, '')
  assert.strictEqual(stripped.mediaEnhancement.providers.subtitles.openSubtitlesUserAgent, 'MY-ZYPlayer v2.9')
  assert.strictEqual(stripped.theme, 'dark')
  assert.strictEqual(settings.mediaEnhancement.providers.danmaku.dandanplayAppSecret, 'dandan-secret')

  assert.deepStrictEqual(buildLegacySecretClearPatch(settings), {
    mediaEnhancement: {
      providers: {
        danmaku: {
          dandanplayAppSecret: '',
          compatibleToken: ''
        },
        subtitles: {
          jimakuApiKey: '',
          assrtApiToken: '',
          openSubtitlesApiKey: '',
          subdlApiKey: ''
        }
      }
    }
  })

  const writes = []
  let encrypted = {}
  const store = {
    async update (patch) {
      encrypted = { ...encrypted, ...patch }
    },
    async readForMainProcess () {
      return { ...encrypted }
    }
  }

  const result = await migrateLegacySecrets({
    readSettings: async () => settings,
    writeSettingsPatch: async patch => writes.push(patch),
    secretStore: store
  })
  assert.strictEqual(result.migrated, true)
  assert.strictEqual(result.count, 6)
  assert.strictEqual(writes.length, 1)
  assert.deepStrictEqual(writes[0], buildLegacySecretClearPatch(settings))

  const noSecrets = stripLegacySecrets(settings)
  const noOpWrites = []
  const noOp = await migrateLegacySecrets({
    readSettings: async () => noSecrets,
    writeSettingsPatch: async patch => noOpWrites.push(patch),
    secretStore: {
      async update () { throw new Error('must not be called') },
      async readForMainProcess () { throw new Error('must not be called') }
    }
  })
  assert.deepStrictEqual(noOp, { migrated: false, count: 0 })
  assert.deepStrictEqual(noOpWrites, [])

  const writeFailureWrites = []
  await assert.rejects(
    () => migrateLegacySecrets({
      readSettings: async () => settings,
      writeSettingsPatch: async patch => writeFailureWrites.push(patch),
      secretStore: {
        async update () { throw new Error('encrypt write failed') },
        async readForMainProcess () { return {} }
      }
    }),
    /encrypt write failed/
  )
  assert.deepStrictEqual(writeFailureWrites, [])

  const verifyFailureWrites = []
  await assert.rejects(
    () => migrateLegacySecrets({
      readSettings: async () => settings,
      writeSettingsPatch: async patch => verifyFailureWrites.push(patch),
      secretStore: {
        async update () {},
        async readForMainProcess () { return { jimakuApiKey: 'wrong' } }
      }
    }),
    /verification/i
  )
  assert.deepStrictEqual(verifyFailureWrites, [])

  const alreadyMigratedSettings = stripLegacySecrets(settings)
  const repeat = await migrateLegacySecrets({
    readSettings: async () => alreadyMigratedSettings,
    writeSettingsPatch: async () => { throw new Error('must not write') },
    secretStore: store
  })
  assert.deepStrictEqual(repeat, { migrated: false, count: 0 })

  console.log('Secret migration tests passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
