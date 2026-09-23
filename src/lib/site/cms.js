const parser = require('fast-xml-parser')

const xmlConfig = {
  trimValues: true,
  textNodeName: '_t',
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  parseAttributeValue: true
}

function asArray (value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function parseRaw (data) {
  if (data && typeof data === 'object') return data
  const text = String(data || '').trim()
  if (!text) return {}
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text)
    } catch (e) {}
  }
  return parser.parse(text, xmlConfig)
}

function playGroups (video) {
  if (video.dl && video.dl.dd) return video.dl
  const from = String(video.vod_play_from || video.play_from || 'default').split('$$$')
  const urls = String(video.vod_play_url || video.play_url || '').split('$$$')
  const groups = urls.filter(Boolean).map((entry, index) => ({
    _flag: from[index] || from[0] || 'default',
    _t: entry
  }))
  if (!groups.length) return { dd: { _flag: from[0] || 'default', _t: '' } }
  return { dd: groups.length === 1 ? groups[0] : groups }
}

function normalizeVideo (video) {
  if (!video || typeof video !== 'object') return video
  if (video.id !== undefined && video.name !== undefined && video.dl) return video
  return {
    ...video,
    id: video.id ?? video.vod_id,
    name: video.name ?? video.vod_name ?? '',
    pic: video.pic ?? video.vod_pic ?? '',
    note: video.note ?? video.vod_remarks ?? video.vod_note ?? '',
    type: video.type ?? video.type_name ?? '',
    actor: video.actor ?? video.vod_actor ?? '',
    director: video.director ?? video.vod_director ?? '',
    area: video.area ?? video.vod_area ?? '',
    year: video.year ?? video.vod_year ?? '',
    des: video.des ?? video.vod_content ?? video.vod_blurb ?? '',
    lang: video.lang ?? video.vod_lang ?? '',
    last: video.last ?? video.vod_time ?? '',
    dl: playGroups(video)
  }
}

function normalizeJson (json) {
  if (Array.isArray(json)) {
    return {
      list: {
        _page: 1,
        _pagecount: 1,
        _pagesize: json.length,
        _recordcount: json.length,
        video: json.map(normalizeVideo)
      }
    }
  }

  const classes = asArray(json.class || json.classes || json.type).map(item => {
    if (item && item._id !== undefined && item._t !== undefined) return item
    if (typeof item === 'string') return { _id: item, _t: item }
    return {
      _id: item?.type_id ?? item?.id ?? item?.typeId ?? '',
      _t: item?.type_name ?? item?.name ?? item?.typeName ?? ''
    }
  }).filter(item => item._t !== '')

  const rawList = json.list && !Array.isArray(json.list) && json.list.video !== undefined
    ? json.list.video
    : (json.list || json.data?.list || json.data || [])
  const videos = asArray(rawList).filter(item => item && typeof item === 'object').map(normalizeVideo)
  const listMeta = json.list && !Array.isArray(json.list) ? json.list : {}

  return {
    ...json,
    class: classes.length ? { ty: classes } : json.class,
    list: {
      ...listMeta,
      _page: Number(json.page ?? listMeta._page ?? json.data?.page ?? 1),
      _pagecount: Number(json.pagecount ?? listMeta._pagecount ?? json.data?.pagecount ?? 1),
      _pagesize: Number(json.limit ?? json.pagesize ?? listMeta._pagesize ?? videos.length),
      _recordcount: Number(json.total ?? json.recordcount ?? listMeta._recordcount ?? videos.length),
      video: videos
    }
  }
}

function parse (data) {
  const raw = parseRaw(data)
  if (raw && raw.rss !== undefined) return raw.rss
  if (raw && raw.list && raw.list._page !== undefined && raw.list.video !== undefined) return raw
  return normalizeJson(raw || {})
}

module.exports = {
  xmlConfig,
  parse,
  normalizeVideo,
  asArray
}
