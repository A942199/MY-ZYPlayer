'use strict'

const assert = require('assert')
const { normalizeGroups, clampEpisodeIndex, choosePlaylist, findEpisodeIndex, hasPlaybackHeaders } = require('../src/lib/playback/playlist')

function main () {
  assert.deepStrictEqual(normalizeGroups(null), [])
  assert.deepStrictEqual(normalizeGroups([{ flag: 'x', list: [] }, null]), [])
  assert.strictEqual(clampEpisodeIndex(-3, 5), 0)
  assert.strictEqual(clampEpisodeIndex(99, 3), 2)
  assert.strictEqual(clampEpisodeIndex('1', 3), 1)

  const groups = [
    { flag: 'line-a', list: ['1$https://a/1.m3u8', '2$https://a/2.m3u8'] },
    { flag: 'line-b', list: ['1$https://b/1.m3u8'] }
  ]

  const selected = choosePlaylist(groups, 'line-b', 0)
  assert.strictEqual(selected.flag, 'line-b')
  assert.strictEqual(selected.fallback, false)
  assert.strictEqual(selected.playlist.length, 1)

  const fallback = choosePlaylist(groups, 'removed-line', 8)
  assert.strictEqual(fallback.flag, 'line-a')
  assert.strictEqual(fallback.fallback, true)
  assert.strictEqual(fallback.index, -1)

  assert.throws(() => choosePlaylist([], '', 0), /有效播放列表/)

  const withSpecial = ['特别篇$https://x/special.m3u8', '第01集$https://x/1.m3u8', '第02集$https://x/2.m3u8']
  assert.strictEqual(findEpisodeIndex(withSpecial, 2, 1), 2, 'Explicit episode labels must win over inherited array index')
  assert.strictEqual(findEpisodeIndex(['播放$https://x/a.m3u8', '播放$https://x/b.m3u8'], 2, 0), 1, 'Position fallback is allowed only when labels carry no episode evidence')
  assert.strictEqual(hasPlaybackHeaders(null), false)
  assert.strictEqual(hasPlaybackHeaders([]), false)
  assert.strictEqual(hasPlaybackHeaders({}), false)
  assert.strictEqual(hasPlaybackHeaders({ Referer: 'https://example.test/' }), true, 'Provider header objects must be recognized as non-empty')
  assert.strictEqual(hasPlaybackHeaders([{ Origin: 'https://example.test' }]), true, 'Provider header arrays must remain supported')
  console.log('Playback playlist unit tests passed')
}

main()
