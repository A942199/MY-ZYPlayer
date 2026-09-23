const { ipcRenderer } = require('electron')

const TAB_PREFIX = 'myvideo-tab:'
const PLAY_PREFIX = 'myvideo-play:'
const ID_PREFIX = 'myvideo-id:'
const pageState = new Map()

function isSource (site) {
  if (!site) return false
  return Number(site.type) === 3 &&
    typeof site.ext === 'string' &&
    (String(site.api || '').startsWith('csp_') || /\.js(?:$|\?)/i.test(site.ext))
}

function encodePayload (value) {
  return encodeURIComponent(JSON.stringify(value || {}))
}

function decodePayload (value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null
  try {
    return JSON.parse(decodeURIComponent(value.slice(prefix.length)))
  } catch (e) {
    return null
  }
}

function encodedId (card) {
  return ID_PREFIX + encodePayload({
    id: String(card.vod_id ?? card.id ?? ''),
    ext: card.ext || {},
    name: card.vod_name ?? card.name ?? '',
    pic: card.vod_pic ?? card.pic ?? '',
    note: card.vod_remarks ?? card.note ?? ''
  })
}

function normalizeCard (card) {
  const id = encodedId(card)
  return {
    id,
    name: card.vod_name ?? card.name ?? '',
    pic: card.vod_pic ?? card.pic ?? '',
    note: card.vod_remarks ?? card.note ?? '',
    year: card.vod_year ?? card.year ?? '',
    type: card.type_name ?? card.type ?? '',
    actor: card.vod_actor ?? card.actor ?? '',
    director: card.vod_director ?? card.director ?? '',
    des: card.vod_content ?? card.des ?? '',
    dl: {
      dd: {
        _flag: 'myvideo',
        _t: '播放$' + PLAY_PREFIX + encodePayload({ ext: card.ext || {}, id: card.vod_id ?? card.id })
      }
    }
  }
}

async function runtimeCall (site, method, args) {
  return await ipcRenderer.invoke('myvideo:call', {
    source: {
      key: site.key,
      name: site.name,
      api: site.api,
      ext: site.ext,
      network: site.network || 'native',
      config: site.extConfig || site.config || {}
    },
    method,
    args
  })
}

async function config (site) {
  return (await runtimeCall(site, 'getConfig')) || {}
}

async function classes (site) {
  const data = await config(site)
  return {
    class: (data.tabs || []).map((tab, index) => ({
      tid: TAB_PREFIX + index,
      name: tab.name || ('分类 ' + (index + 1))
    })),
    page: 1,
    pagecount: 999,
    pagesize: 20,
    recordcount: 0
  }
}

async function page () {
  return {
    page: 1,
    pagecount: 999,
    pagesize: 20,
    recordcount: 0
  }
}

async function list (site, pg, tid) {
  const data = await config(site)
  const tabs = data.tabs || []
  let index = 0
  if (typeof tid === 'string' && tid.startsWith(TAB_PREFIX)) {
    index = Number(tid.slice(TAB_PREFIX.length)) || 0
  }
  const tab = tabs[index] || tabs[0] || { ext: {} }
  const args = {
    ...(tab.ext || {}),
    id: tab.ext?.id ?? tab.id ?? '',
    ext: tab.ext || {},
    page: pg
  }
  const result = (await runtimeCall(site, 'getCards', args)) || {}
  pageState.set(site.key + '@' + String(tid) + '@' + String(pg), Number(result.over) === 1)
  return (result.list || []).map(normalizeCard)
}

function isPageOver (siteKey, tid, pageNo) {
  return pageState.get(siteKey + '@' + String(tid) + '@' + String(pageNo)) === true
}

async function search (site, text) {
  const result = (await runtimeCall(site, 'search', { text, page: 1 })) || {}
  return (result.list || []).map(normalizeCard)
}

function trackMarker (track) {
  return PLAY_PREFIX + encodePayload({
    ext: track.ext || {},
    url: track.url,
    ep: track.ep
  })
}

async function detail (site, encoded) {
  const card = decodePayload(encoded, ID_PREFIX) || { id: encoded, ext: {} }
  const args = {
    ...(card.ext || {}),
    id: card.id,
    ext: card.ext || {}
  }
  const result = (await runtimeCall(site, 'getTracks', args)) || {}
  const groups = (result.list || []).map((group, groupIndex) => {
    const flag = group.title || group.name || ('线路' + (groupIndex + 1))
    const tracks = (group.tracks || group.list || []).map((track, trackIndex) => {
      const name = track.name || ('第' + (trackIndex + 1) + '集')
      return name + '$' + trackMarker(track)
    })
    return { flag, list: tracks }
  }).filter(group => group.list.length)
  const dd = groups.map(group => ({ _flag: group.flag, _t: group.list.join('#') }))
  const meta = result.detail || result.vod || result

  return {
    id: encoded,
    name: meta.vod_name || meta.name || card.name || '',
    pic: meta.vod_pic || meta.pic || card.pic || '',
    note: meta.vod_remarks || meta.note || card.note || '',
    type: meta.type_name || meta.type || '',
    actor: meta.vod_actor || meta.actor || '',
    director: meta.vod_director || meta.director || '',
    area: meta.vod_area || meta.area || '',
    year: meta.vod_year || meta.year || '',
    des: meta.vod_content || meta.des || '',
    dl: { dd: dd.length === 1 ? dd[0] : dd },
    fullList: groups
  }
}

async function play (site, marker) {
  const track = decodePayload(marker, PLAY_PREFIX)
  if (!track) return null
  const args = {
    ...(track.ext || {}),
    url: track.url ?? track.ext?.url,
    ep: track.ep ?? track.ext?.ep,
    ext: track.ext || {}
  }
  const result = (await runtimeCall(site, 'getPlayinfo', args)) || {}
  const urls = result.urls || []
  return {
    url: urls[0] || '',
    urls,
    headers: result.headers || []
  }
}

async function check (site) {
  try {
    await config(site)
    return true
  } catch (e) {
    return false
  }
}

async function loadConfig (url) {
  return await ipcRenderer.invoke('myvideo:load-config', url)
}

function normalizeImportedSite (site, index, configUrl) {
  const myvideo = Number(site.type) === 3 && typeof site.ext === 'string'
  const key = site.key || site.api || ('source-' + (index + 1))
  return {
    ...site,
    key,
    name: site.name || key,
    api: site.api || '',
    ext: site.ext || '',
    extConfig: site.extConfig || site.config || {},
    network: site.network || 'native',
    sourceKind: myvideo ? 'myvideo' : 'cms',
    configUrl,
    download: site.download || '',
    jiexiUrl: site.jiexiUrl || '',
    group: site.group || (myvideo ? 'CatVod/MyVideo' : 'CMS'),
    isActive: site.isActive !== false,
    reverseOrder: myvideo ? true : Boolean(site.reverseOrder)
  }
}

function importSites (payload, configUrl) {
  if (typeof payload === 'string') payload = JSON.parse(payload)
  const list = Array.isArray(payload) ? payload : (payload?.sites || [])
  return list
    .filter(site => {
      if (!site || typeof site !== 'object') return false
      if (Number(site.type) === 3) return typeof site.ext === 'string' && site.ext.length > 0
      return typeof site.api === 'string' && /^https?:\/\//i.test(site.api)
    })
    .map((site, index) => normalizeImportedSite(site, index, configUrl))
}

module.exports = {
  isSource,
  classes,
  page,
  list,
  search,
  detail,
  play,
  check,
  isPageOver,
  loadConfig,
  importSites,
  PLAY_PREFIX
}
