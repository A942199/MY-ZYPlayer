'use strict'

const { RuntimeManager } = require('../src/main/myvideo/runtime')

const TV_URL = 'https://raw.githubusercontent.com/A942199/yuan/refs/heads/main/TV.json'
const CONCURRENCY = 6
const manager = new RuntimeManager({ callTimeout: 8000 })

function classifyError (error) {
  if (!error) return 'ok'
  if (error.code === 'MYVIDEO_WEBVIEW_REQUIRED') return 'webview'
  if (error.code === 'MYVIDEO_TIMEOUT' || error.code === 'ETIMEDOUT') return 'timeout'
  if (error.code === 'MYVIDEO_SCRIPT_INIT') return 'runtime'
  return 'source-error'
}

function messageOf (error) {
  return String(error && error.message || error || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer <REDACTED>')
    .replace(/[A-Za-z0-9_-]{80,}/g, '<REDACTED>')
    .slice(0, 160)
}

async function probe (site) {
  const source = {
    key: site.key || site.api,
    name: site.name,
    api: site.api,
    ext: site.ext,
    network: 'native'
  }
  const row = {
    api: source.api,
    name: source.name,
    config: 'skip',
    cards: 'skip',
    tracks: 'skip',
    play: 'skip',
    search: 'skip',
    result: 'direct'
  }
  try {
    const config = await manager.call(source, 'getConfig')
    row.config = 'ok'
    const tab = config && config.tabs && config.tabs[0]
    if (tab) {
      const ext = tab.ext || {}
      const cards = await manager.call(source, 'getCards', {
        ...ext,
        id: ext.id || tab.id || '',
        ext,
        page: 1
      })
      row.cards = 'ok'
      const card = cards && cards.list && cards.list[0]
      if (card) {
        const cardExt = card.ext || {}
        const tracks = await manager.call(source, 'getTracks', {
          ...cardExt,
          id: card.vod_id || card.id || cardExt.id || '',
          ext: cardExt
        })
        row.tracks = 'ok'
        const group = tracks && tracks.list && tracks.list[0]
        const track = group && (group.tracks || group.list) && (group.tracks || group.list)[0]
        if (track) {
          const trackExt = track.ext || {}
          const play = await manager.call(source, 'getPlayinfo', {
            ...trackExt,
            url: track.url || trackExt.url,
            ep: track.ep || trackExt.ep,
            ext: trackExt
          })
          row.play = play && play.urls && play.urls.length ? 'ok' : 'empty'
        }
      }
    }
    try {
      const search = await manager.call(source, 'search', { text: '测试', page: 1 })
      row.search = search && Array.isArray(search.list) ? 'ok' : 'empty'
    } catch (error) {
      row.search = classifyError(error)
    }
  } catch (error) {
    const kind = classifyError(error)
    if (row.config === 'skip') row.config = kind
    else if (row.cards === 'skip') row.cards = kind
    else if (row.tracks === 'skip') row.tracks = kind
    else if (row.play === 'skip') row.play = kind
    row.result = kind === 'webview' ? 'webview-candidate' : (kind === 'runtime' ? 'polyfill/runtime' : 'source-failure')
    row.error = messageOf(error)
  }
  return row
}

async function mapLimit (items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker () {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function main () {
  const config = await manager.loadConfig(TV_URL)
  const sites = Array.isArray(config) ? config : (config.sites || [])
  const rows = await mapLimit(sites, CONCURRENCY, probe)
  const summary = rows.reduce((acc, row) => {
    acc[row.result] = (acc[row.result] || 0) + 1
    return acc
  }, {})
  console.log(JSON.stringify({
    total: rows.length,
    summary,
    problems: rows.filter(row => row.result !== 'direct' || row.play === 'empty')
  }, null, 2))
  if (!rows.length) process.exitCode = 1
}

main()
  .catch(error => {
    console.error(messageOf(error))
    process.exitCode = 1
  })
  .finally(() => {
    manager.clear()
    setTimeout(() => process.exit(process.exitCode || 0), 50)
  })
