'use strict'

const { normalizeDanmakuComments } = require('./media-enhancement')

function lowerBound (rows, time) {
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const middle = (lo + hi) >> 1
    if (Number(rows[middle].time) < time) lo = middle + 1
    else hi = middle
  }
  return lo
}

class DanmakuController {
  constructor ({ video, host, request, settings, onState }) {
    this.video = video
    this.host = host
    this.request = request
    this.settings = { ...settings }
    this.onState = typeof onState === 'function' ? onState : () => {}
    this.comments = []
    this.active = []
    this.cursor = 0
    this.lastTime = -1
    this.frame = 0
    this.generation = 0
    this.destroyed = false
    this.status = '未匹配'
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'zy-danmaku-canvas'
    this.ctx = this.canvas.getContext('2d')
    try {
      if (window.getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative'
    } catch (error) {}
    this.host.appendChild(this.canvas)
    this.resize = this.resize.bind(this)
    this.draw = this.draw.bind(this)
    if (window.ResizeObserver) {
      this.resizeObserver = new window.ResizeObserver(this.resize)
      this.resizeObserver.observe(this.video)
    } else {
      window.addEventListener('resize', this.resize)
    }
    this.resize()
    this.frame = window.requestAnimationFrame(this.draw)
  }

  emit () {
    this.onState({
      enabled: this.settings.enabled !== false,
      status: this.status,
      count: this.comments.length,
      settings: { ...this.settings }
    })
  }

  resize () {
    if (this.destroyed || !this.video || !this.canvas) return
    const rect = this.video.getBoundingClientRect()
    const hostRect = this.host.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(rect.width * dpr))
    const height = Math.max(1, Math.round(rect.height * dpr))
    this.canvas.style.left = Math.max(0, rect.left - hostRect.left) + 'px'
    this.canvas.style.top = Math.max(0, rect.top - hostRect.top) + 'px'
    this.canvas.style.width = Math.max(1, Math.round(rect.width)) + 'px'
    this.canvas.style.height = Math.max(1, Math.round(rect.height)) + 'px'
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
      if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
  }

  resetTimeline (time) {
    this.active = []
    this.cursor = lowerBound(this.comments, Math.max(0, Number(time || 0) + Number(this.settings.offset || 0) - 0.15))
    this.lastTime = Number(time || 0)
  }

  laneFor (mode, laneHeight, height) {
    const max = Math.max(1, Math.floor((height * Number(this.settings.area || 0.62)) / laneHeight))
    if (mode === 'bottom') return Math.max(0, max - 1 - (this.active.filter(item => item.mode === 'bottom').length % max))
    if (mode === 'top') return this.active.filter(item => item.mode === 'top').length % max
    const used = new Set(this.active.filter(item => item.mode === 'scroll').map(item => item.lane))
    for (let i = 0; i < max; i++) if (!used.has(i)) return i
    return Math.floor(Math.random() * max)
  }

  spawn (row, now, width, height) {
    if (!this.ctx) return
    const fontSize = Number(this.settings.fontSize || 24)
    this.ctx.font = '700 ' + fontSize + 'px system-ui,-apple-system,sans-serif'
    const textWidth = Math.min(width * 0.9, this.ctx.measureText(row.text).width + 8)
    const laneHeight = fontSize + 8
    this.active.push({
      text: row.text,
      color: row.color || '#ffffff',
      mode: row.mode || 'scroll',
      lane: this.laneFor(row.mode, laneHeight, height),
      width: textWidth,
      born: now,
      startX: width
    })
  }

  draw () {
    this.frame = window.requestAnimationFrame(this.draw)
    if (this.destroyed || !this.ctx || !this.canvas) return
    const width = this.canvas.clientWidth || 1
    const height = this.canvas.clientHeight || 1
    this.ctx.clearRect(0, 0, width, height)
    if (this.settings.enabled === false || !this.comments.length || !this.video || this.video.readyState < 1) return

    const time = Number(this.video.currentTime || 0)
    const offset = Number(this.settings.offset || 0)
    const effective = time + offset
    if (this.lastTime < 0 || Math.abs(time - this.lastTime) > 2) this.resetTimeline(time)
    if (!this.video.paused && !this.video.seeking) {
      while (this.cursor < this.comments.length && this.comments[this.cursor].time <= effective + 0.08) {
        if (this.comments[this.cursor].time >= effective - 0.35) this.spawn(this.comments[this.cursor], window.performance.now(), width, height)
        this.cursor += 1
      }
    }
    this.lastTime = time

    const now = window.performance.now()
    const fontSize = Number(this.settings.fontSize || 24)
    this.ctx.font = '700 ' + fontSize + 'px system-ui,-apple-system,sans-serif'
    this.ctx.textBaseline = 'top'
    this.ctx.globalAlpha = Number(this.settings.opacity || 0.86)
    this.ctx.lineWidth = 3
    this.ctx.strokeStyle = 'rgba(0,0,0,.72)'
    this.active = this.active.filter(item => {
      const age = (now - item.born) / 1000
      let y = item.lane * (fontSize + 8) + 6
      let x
      if (item.mode === 'top' || item.mode === 'bottom') {
        if (age > 4.5) return false
        x = (width - item.width) / 2
        if (item.mode === 'bottom') y = Math.max(6, height * Number(this.settings.area || 0.62) - fontSize - 8 - item.lane * (fontSize + 8))
      } else {
        x = item.startX - age * Number(this.settings.speed || 150)
        if (x + item.width < 0) return false
      }
      this.ctx.strokeText(item.text, x, y)
      this.ctx.fillStyle = item.color
      this.ctx.fillText(item.text, x, y)
      return true
    })
    this.ctx.globalAlpha = 1
  }

  async setMedia (media, config, force = false) {
    const generation = ++this.generation
    this.comments = []
    this.resetTimeline(Number(this.video && this.video.currentTime || 0))
    if (this.settings.enabled === false) {
      this.status = '已关闭'
      this.emit()
      return
    }
    if (!media || !media.title) {
      this.status = '缺少影片信息'
      this.emit()
      return
    }
    this.status = '多源匹配中…'
    this.emit()
    try {
      const data = await this.request({ config, media, force })
      if (generation !== this.generation || this.destroyed) return
      if (data && data.matched) {
        this.comments = normalizeDanmakuComments(data.comments)
        this.status = String(data.providerName || data.provider || '已匹配') + (data.failover ? ' · 自动切源' : '')
      } else if (data && data.enabled === false) {
        this.status = '未配置弹幕源'
      } else if (data && (data.transientFailure || data.retryable || data.transientCacheHit)) {
        this.status = '弹幕源暂时不可用'
      } else if (data && Array.isArray(data.dmkuReasons) && data.dmkuReasons.includes('candidate_found_no_usable_source_url')) {
        this.status = '已找到作品 · 暂无可用弹幕源'
      } else {
        this.status = '暂无匹配'
      }
      this.resetTimeline(Number(this.video.currentTime || 0))
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return
      this.status = String(error && error.message || error || '弹幕不可用')
      this.comments = []
    }
    this.emit()
  }

  setEnabled (enabled) {
    this.settings.enabled = enabled !== false
    if (!this.settings.enabled) {
      this.generation += 1
      this.comments = []
      this.active = []
      this.cursor = 0
      if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.clientWidth || 1, this.canvas.clientHeight || 1)
      this.status = '已关闭'
    } else if (this.status === '已关闭') {
      this.status = '未匹配'
    }
    this.emit()
  }

  updateSettings (next) {
    this.settings = { ...this.settings, ...(next || {}) }
    this.resetTimeline(Number(this.video && this.video.currentTime || 0))
    this.emit()
  }

  clear () {
    this.generation += 1
    this.comments = []
    this.active = []
    this.status = '未匹配'
    this.resetTimeline(0)
    this.emit()
  }

  destroy () {
    this.destroyed = true
    this.generation += 1
    if (this.frame) window.cancelAnimationFrame(this.frame)
    if (this.resizeObserver) this.resizeObserver.disconnect()
    else window.removeEventListener('resize', this.resize)
    if (this.canvas && this.canvas.parentElement) this.canvas.parentElement.removeChild(this.canvas)
    this.canvas = null
    this.ctx = null
  }
}

module.exports = { DanmakuController }
