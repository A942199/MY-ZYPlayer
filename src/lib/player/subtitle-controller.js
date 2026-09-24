'use strict'

const { allowedSubtitleCandidates } = require('./media-enhancement')

function embeddedAllowed (track) {
  const language = String(track && track.language || '').toLowerCase().trim()
  const text = (language + ' ' + String(track && track.label || '')).toLowerCase()
  const japanese = /\bja\b|\bjpn\b|japanese|日本|日語|日语/.test(text)
  const english = /\ben\b|\beng\b|english|英语|英文/.test(text)
  return japanese && !english
}

function embeddedScore (track) {
  const text = (String(track && track.language || '') + ' ' + String(track && track.label || '')).toLowerCase()
  const japanese = /\bja\b|\bjpn\b|japanese|日本|日語|日语/.test(text)
  const chinese = /\bzh\b|\bchi\b|\bzho\b|chinese|中文|简体|簡體|繁體|繁体/.test(text)
  if (japanese && chinese) return 400
  if (japanese) return 300
  return -1
}

function bestEmbeddedTrack (video) {
  if (!video || !video.textTracks) return null
  let best = null
  let score = -1
  for (let i = 0; i < video.textTracks.length; i++) {
    const track = video.textTracks[i]
    if (!track || !['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()) || !embeddedAllowed(track)) continue
    const current = embeddedScore(track) + (track.mode === 'showing' ? 1000 : 0)
    if (current > score) {
      best = track
      score = current
    }
  }
  return best
}

function disableTextTracks (video, except) {
  if (!video || !video.textTracks) return
  for (let i = 0; i < video.textTracks.length; i++) {
    const track = video.textTracks[i]
    if (track === except) continue
    try { track.mode = 'disabled' } catch (error) {}
  }
}

const KANA = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'wo',ん:'n',
  が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
  ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ゔ:'vu',
  ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo'
}
const KANA_COMBO = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',しゃ:'sha',しゅ:'shu',しょ:'sho',
  じゃ:'ja',じゅ:'ju',じょ:'jo',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',
  ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',
  てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',しぇ:'she',じぇ:'je',ちぇ:'che',うぃ:'wi',うぇ:'we',うぉ:'wo',
  ゔぁ:'va',ゔぃ:'vi',ゔぇ:'ve',ゔぉ:'vo'
}

function romanizeKanaTitle (value) {
  const source = String(value || '').normalize('NFKC').replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 96)).trim()
  if (!source || /[\u3400-\u9fff]/.test(source) || !/[ぁ-ゖ]/.test(source)) return ''
  let out = ''
  let geminate = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === 'っ') { geminate = true; continue }
    if (ch === 'ー') {
      const match = out.match(/[aeiou](?!.*[aeiou])/i)
      if (match) out += match[0].toLowerCase()
      continue
    }
    if (/\s|[・･\/／|｜:：·._-]/.test(ch)) {
      if (out && !out.endsWith(' ')) out += ' '
      geminate = false
      continue
    }
    const pair = source.slice(i, i + 2)
    let roma = KANA_COMBO[pair]
    if (roma) i += 1
    else roma = KANA[ch] || ''
    if (!roma) {
      geminate = false
      continue
    }
    if (geminate) {
      const consonant = roma.match(/^(ch|sh|ts|[bcdfghjkmprstvwz])/i)
      if (consonant) out += consonant[0] === 'ch' ? 't' : consonant[0][0]
      geminate = false
    }
    out += roma
  }
  return out.replace(/\s+/g, ' ').trim().replace(/(^|\s)([a-z])/g, (match, lead, char) => lead + char.toUpperCase())
}

class SubtitleController {
  constructor ({ video, resolveRequest, fetchRequest, onState }) {
    this.video = video
    this.resolveRequest = resolveRequest
    this.fetchRequest = fetchRequest
    this.onState = typeof onState === 'function' ? onState : () => {}
    this.enabled = false
    this.candidates = []
    this.selectedIndex = -1
    this.status = '字幕已关闭'
    this.generation = 0
    this.media = null
    this.config = null
    this.urls = []
  }

  emit () {
    this.onState({
      enabled: this.enabled,
      status: this.status,
      candidates: this.candidates.slice(),
      selectedIndex: this.selectedIndex
    })
  }

  cleanupManagedTracks () {
    this.urls.forEach(url => {
      try { window.URL.revokeObjectURL(url) } catch (error) {}
    })
    this.urls = []
    if (!this.video) return
    Array.from(this.video.querySelectorAll('track[data-zy-companion-subtitle]')).forEach(track => track.remove())
  }

  beginMedia (media, config, defaultEnabled) {
    this.generation += 1
    this.media = media || null
    this.config = config || null
    this.enabled = defaultEnabled === true
    this.candidates = []
    this.selectedIndex = -1
    this.cleanupManagedTracks()
    disableTextTracks(this.video, null)
    this.status = this.enabled ? '字幕待匹配' : '字幕已关闭'
    this.emit()
    if (this.enabled) this.resolve(false)
  }

  async resolve (force) {
    if (!this.enabled || !this.media) return
    const generation = this.generation
    this.status = '字幕匹配中…'
    this.emit()
    try {
      let data = await this.resolveRequest({ config: this.config, media: this.media, force: force === true })
      if (generation !== this.generation) return
      let rows = allowedSubtitleCandidates(data && data.candidates)
      if (!rows.length) {
        const identity = data && data.identity || {}
        const romanized = romanizeKanaTitle(identity.originalTitle)
        if (romanized && String(identity.englishTitle || '').toLowerCase() !== romanized.toLowerCase()) {
          const aliases = Array.isArray(identity.aliases) ? identity.aliases.slice() : []
          if (!aliases.some(item => String(item).toLowerCase() === romanized.toLowerCase())) aliases.push(romanized)
          data = await this.resolveRequest({
            config: this.config,
            media: { ...identity, ...this.media, englishTitle: romanized, aliases },
            force: true
          })
          if (generation !== this.generation) return
          rows = allowedSubtitleCandidates(data && data.candidates)
        }
      }

      this.candidates = rows
      const embedded = bestEmbeddedTrack(this.video)
      if (embedded) {
        disableTextTracks(this.video, embedded)
        embedded.mode = 'showing'
        this.status = '字幕·内嵌日语'
        this.selectedIndex = -2
        this.emit()
        return
      }

      const autoIndex = Number(data && data.autoSelectIndex)
      if (Number.isInteger(autoIndex) && autoIndex >= 0 && rows[autoIndex]) {
        await this.select(autoIndex)
      } else if (rows.length) {
        this.status = '找到字幕，请选择'
        this.selectedIndex = -1
        this.emit()
      } else {
        this.status = '暂无日语/日中双语字幕'
        this.selectedIndex = -1
        this.emit()
      }
    } catch (error) {
      if (generation !== this.generation) return
      this.status = String(error && error.message || error || '字幕请求失败')
      this.candidates = []
      this.selectedIndex = -1
      this.emit()
    }
  }

  async select (index) {
    const candidate = this.candidates[Number(index)]
    if (!candidate || !this.enabled) return false
    const generation = this.generation
    this.status = '字幕加载中…'
    this.emit()
    try {
      const result = await this.fetchRequest({ config: this.config, fetchUrl: candidate.fetchUrl })
      if (generation !== this.generation || !this.enabled) return false
      if (!result || !String(result.text || '').includes('-->')) throw new Error('字幕文件无有效 cue')

      this.cleanupManagedTracks()
      disableTextTracks(this.video, null)
      const blob = new Blob([result.text], { type: 'text/vtt;charset=utf-8' })
      const url = window.URL.createObjectURL(blob)
      this.urls.push(url)
      const track = document.createElement('track')
      track.kind = 'subtitles'
      track.label = candidate.label || (candidate.language === 'ja-zh' ? '日中双语' : '日本語')
      track.srclang = 'ja'
      track.src = url
      track.dataset.zyCompanionSubtitle = '1'
      this.video.appendChild(track)

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('字幕轨道加载超时')), 2500)
        const activate = () => {
          try {
            if (track.track) track.track.mode = 'showing'
            clearTimeout(timer)
            resolve()
          } catch (error) {
            clearTimeout(timer)
            reject(error)
          }
        }
        track.addEventListener('load', activate, { once: true })
        track.addEventListener('error', () => {
          clearTimeout(timer)
          reject(new Error('字幕轨道加载失败'))
        }, { once: true })
        if (track.readyState === 2) activate()
      })

      if (generation !== this.generation || !this.enabled) return false
      this.selectedIndex = Number(index)
      this.status = candidate.language === 'ja-zh' ? '字幕·日中双语' : '字幕·日语'
      this.emit()
      return true
    } catch (error) {
      if (generation !== this.generation) return false
      this.status = String(error && error.message || error || '字幕加载失败')
      this.selectedIndex = -1
      this.emit()
      return false
    }
  }

  enable (resolveNow = true) {
    if (this.enabled) return
    this.enabled = true
    this.status = '字幕待匹配'
    this.emit()
    if (resolveNow !== false) this.resolve(false)
  }

  disable () {
    this.generation += 1
    this.enabled = false
    this.selectedIndex = -1
    this.cleanupManagedTracks()
    disableTextTracks(this.video, null)
    this.status = '字幕已关闭'
    this.emit()
  }

  destroy () {
    this.generation += 1
    this.cleanupManagedTracks()
    this.video = null
  }
}

module.exports = {
  SubtitleController,
  embeddedAllowed,
  romanizeKanaTitle
}
