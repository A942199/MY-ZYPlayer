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

function stageError (row, stage, error) {
  const kind = classifyError(error)
  row[stage] = kind
  row.errors.push({ stage, kind, message: messageOf(error) })
  return kind
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
    tabs: 0,
    tabsTried: 0,
    defaultEmpty: false,
    selectedTab: '',
    result: 'source-failure',
    errors: []
  }

  let config
  try {
    config = await manager.call(source, 'getConfig')
    row.config = 'ok'
  } catch (error) {
    stageError(row, 'config', error)
  }

  let card
  if (row.config === 'ok') {
    const tabs = Array.isArray(config && config.tabs) ? config.tabs : []
    row.tabs = tabs.length
    let sawSuccessfulEmpty = false
    let lastCardsError = null

    for (let index = 0; index < tabs.length; index++) {
      const tab = tabs[index]
      const ext = tab.ext || {}
      row.tabsTried++
      try {
        const cards = await manager.call(source, 'getCards', {
          ...ext,
          id: ext.id || tab.id || '',
          ext,
          page: 1
        })
        const list = cards && Array.isArray(cards.list) ? cards.list : []
        if (!list.length) {
          sawSuccessfulEmpty = true
          if (index === 0) row.defaultEmpty = true
          continue
        }
        row.cards = 'ok'
        row.selectedTab = tab.name || String(tab.id || index)
        card = list[0]
        break
      } catch (error) {
        lastCardsError = error
        if (index === 0) row.defaultEmpty = true
      }
    }

    if (!card) {
      if (sawSuccessfulEmpty) {
        row.cards = 'empty'
        row.errors.push({ stage: 'cards', kind: 'empty', message: 'No cards in any configured tab' })
      } else if (lastCardsError) {
        stageError(row, 'cards', lastCardsError)
      } else {
        row.cards = 'empty'
        row.errors.push({ stage: 'cards', kind: 'empty', message: 'No configured tabs or cards' })
      }
    }
  }

  let track
  if (card) {
    const cardExt = card.ext || {}
    try {
      const tracks = await manager.call(source, 'getTracks', {
        ...cardExt,
        id: card.vod_id || card.id || cardExt.id || '',
        ext: cardExt
      })
      const group = tracks && Array.isArray(tracks.list) && tracks.list[0]
      track = group && (group.tracks || group.list) && (group.tracks || group.list)[0]
      row.tracks = track ? 'ok' : 'empty'
      if (!track) row.errors.push({ stage: 'tracks', kind: 'empty', message: 'No tracks returned' })
    } catch (error) {
      stageError(row, 'tracks', error)
    }
  }

  if (track) {
    const trackExt = track.ext || {}
    try {
      const play = await manager.call(source, 'getPlayinfo', {
        ...trackExt,
        url: track.url || trackExt.url,
        ep: track.ep || trackExt.ep,
        ext: trackExt
      })
      row.play = play && Array.isArray(play.urls) && play.urls.length ? 'ok' : 'empty'
      if (row.play === 'empty') row.errors.push({ stage: 'play', kind: 'empty', message: 'No playable URL returned' })
    } catch (error) {
      stageError(row, 'play', error)
    }
  }

  if (row.config === 'ok') {
    try {
      const search = await manager.call(source, 'search', { text: '测试', page: 1 })
      row.search = search && Array.isArray(search.list) ? (search.list.length ? 'ok' : 'empty') : 'empty'
    } catch (error) {
      stageError(row, 'search', error)
    }
  }

  const kinds = row.errors.map(item => item.kind)
  if (kinds.includes('runtime')) row.result = 'polyfill/runtime'
  else if (kinds.includes('webview')) row.result = 'webview-candidate'
  else if (row.config === 'ok' && row.cards === 'ok' && row.tracks === 'ok' && row.play === 'ok') {
    row.result = row.defaultEmpty ? 'direct-fallback-tab' : 'direct'
  } else {
    row.result = 'source-failure'
  }

  if (!row.errors.length) delete row.errors
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
  console.log(JSON.stringify({ total: rows.length, summary, rows }))
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
