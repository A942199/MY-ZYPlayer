'use strict'

const assert = require('assert')
const path = require('path')
const { Parser: M3u8Parser } = require('m3u8-parser')
const { NativeHttpClient, RuntimeManager } = require('../src/main/myvideo/runtime')

const TV_URL = 'https://raw.githubusercontent.com/A942199/yuan/refs/heads/main/TV.json'
const root = path.resolve(__dirname, '..')
const workerPath = path.join(root, 'src', 'main', 'myvideo', 'runtime.worker.js')
const modulePath = path.join(root, 'node_modules')

async function main () {
  const manager = new RuntimeManager({ workerPath, modulePath, callTimeout: 30000 })
  const http = new NativeHttpClient()
  try {
    const config = await manager.loadConfig(TV_URL)
    const sites = Array.isArray(config) ? config : (config.sites || [])
    assert(sites.length > 0, 'TV.json contains no sites')
    const huangguo = sites.find(site => site.api === 'csp_huangguo')
    assert(huangguo, 'csp_huangguo not found in TV.json')

    const scriptResponse = await http.get(huangguo.ext)
    assert.strictEqual(scriptResponse.status, 200)
    const scriptText = String(scriptResponse.data || '')
    const tokenMatch = scriptText.match(/LOGIN_TOKEN\s*=\s*['"]([^'"]*)['"]/)
    const tokenMeta = {
      present: Boolean(tokenMatch && tokenMatch[1]),
      length: tokenMatch ? tokenMatch[1].length : 0
    }
    console.log('yuan TV.json sites=' + sites.length)
    console.log('huangguo LOGIN_TOKEN present=' + tokenMeta.present + ' length=' + tokenMeta.length)

    const source = {
      key: huangguo.key || huangguo.api,
      name: huangguo.name,
      api: huangguo.api,
      ext: huangguo.ext,
      network: 'native'
    }

    const sourceConfig = await manager.call(source, 'getConfig')
    assert(sourceConfig && Array.isArray(sourceConfig.tabs) && sourceConfig.tabs.length > 0)

    const cards = await manager.call(source, 'getCards', {
      ...(sourceConfig.tabs[0].ext || {}),
      id: sourceConfig.tabs[0].ext && sourceConfig.tabs[0].ext.id || 'home',
      ext: sourceConfig.tabs[0].ext || {},
      page: 1
    })
    assert(cards && Array.isArray(cards.list))

    const tracks = await manager.call(source, 'getTracks', {
      id: '6139',
      ext: { id: '6139' }
    })
    assert(tracks && Array.isArray(tracks.list) && tracks.list.length > 0)
    const allTracks = tracks.list.flatMap(group => group.tracks || [])
    assert(allTracks.some(track => String(track.ext && track.ext.ep) === '1'), 'mediaId=1 track not found')

    const contentUrl = 'https://pinjiji.vip/content/hgdj/6139/'
    const play = await manager.call(source, 'getPlayinfo', {
      url: contentUrl,
      ep: '1',
      ext: { url: contentUrl, ep: '1' }
    })
    assert(play && Array.isArray(play.urls) && play.urls[0], 'huangguo returned no playback URL')

    const manifestResponse = await http.get(play.urls[0], {
      headers: Array.isArray(play.headers) ? (play.headers[0] || {}) : (play.headers || {})
    })
    assert.strictEqual(manifestResponse.status, 200)

    const parser = new M3u8Parser()
    parser.push(String(manifestResponse.data || ''))
    parser.end()
    const manifest = parser.manifest
    const segments = manifest.segments || []
    const duration = segments.reduce((sum, segment) => sum + Number(segment.duration || 0), 0)
    const endList = Boolean(manifest.endList)

    console.log('huangguo native manifest duration=' + duration.toFixed(3) + ' segments=' + segments.length + ' ENDLIST=' + endList)
    assert.strictEqual(segments.length, 32)
    assert(Math.abs(duration - 199.196) < 2, 'unexpected duration: ' + duration)
    assert.strictEqual(endList, true)

    const search = await manager.call(source, 'search', { text: 'test', page: 1 })
    assert(search && Array.isArray(search.list))

    console.log('yuan/huangguo native integration passed')
  } finally {
    manager.clear()
  }
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
