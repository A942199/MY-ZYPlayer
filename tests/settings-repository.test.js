'use strict'

const assert = require('assert')
const {
  createSettingsRepository,
  mergeSettingsPatch
} = require('../src/lib/settings/repository')

async function main () {
  const merged = mergeSettingsPatch(
    {
      theme: 'light',
      mediaEnhancement: {
        danmaku: { opacity: 0.8, fontSize: 24 },
        providers: { subtitles: { jimakuBaseUrl: 'a' } }
      },
      list: [1, 2],
      keep: 'yes'
    },
    {
      theme: 'dark',
      mediaEnhancement: { danmaku: { opacity: 0.5 } },
      list: [3],
      keep: undefined
    }
  )
  assert.deepStrictEqual(merged, {
    theme: 'dark',
    mediaEnhancement: {
      danmaku: { opacity: 0.5, fontSize: 24 },
      providers: { subtitles: { jimakuBaseUrl: 'a' } }
    },
    list: [3],
    keep: 'yes'
  })

  let current = {
    id: 0,
    theme: 'light',
    mediaEnhancement: { danmakuEnabled: true, subtitlesEnabled: false },
    proxy: { type: 'none', url: '' }
  }
  const writes = []
  const repo = createSettingsRepository({
    read: async () => JSON.parse(JSON.stringify(current)),
    write: async next => {
      await new Promise(resolve => setTimeout(resolve, 5))
      current = JSON.parse(JSON.stringify(next))
      writes.push(current)
      return 1
    }
  })

  assert.deepStrictEqual(await repo.get(), current)
  await repo.updatePatch({ theme: 'dark' })
  assert.strictEqual(current.theme, 'dark')
  assert.deepStrictEqual(current.proxy, { type: 'none', url: '' })

  await Promise.all([
    repo.updatePatch({ mediaEnhancement: { subtitlesEnabled: true } }),
    repo.updatePatch({ proxy: { type: 'manual', url: '127.0.0.1' } })
  ])

  assert.deepStrictEqual(current.mediaEnhancement, {
    danmakuEnabled: true,
    subtitlesEnabled: true
  })
  assert.deepStrictEqual(current.proxy, {
    type: 'manual',
    url: '127.0.0.1'
  })
  assert(writes.length >= 3)

  console.log('Settings repository tests passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
