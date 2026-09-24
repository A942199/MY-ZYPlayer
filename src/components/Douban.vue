<template>
  <div class="douban-page">
    <div class="douban-header">
      <div class="douban-tabs">
        <button :class="{ active: kind === 'movie' }" @click="changeKind('movie')">电影</button>
        <button :class="{ active: kind === 'tv' }" @click="changeKind('tv')">电视剧</button>
      </div>
      <div class="douban-tags" v-if="!searchMode">
        <button v-for="item in tags" :key="item" :class="{ active: tag === item }" @click="changeTag(item)">{{item}}</button>
      </div>
      <div class="douban-search">
        <input v-model.trim="searchText" @keyup.enter="search" placeholder="搜索豆瓣影视" />
        <button @click="search">搜索</button>
        <button v-if="searchMode" @click="clearSearch">返回榜单</button>
      </div>
    </div>

    <div class="douban-status" v-if="loading">正在加载豆瓣内容…</div>
    <div class="douban-status error" v-else-if="error">{{error}}</div>

    <div class="douban-grid zy-scroll" v-if="!selected" @scroll.passive="onGridScroll">
      <div class="douban-card" v-for="item in list" :key="item.id" @click="selectSubject(item)">
        <div class="poster">
          <img :src="coverSrc(item)" :alt="item.title" @error="loadCover(item)" />
          <span class="rate" v-if="item.rate">{{item.rate}}</span>
        </div>
        <div class="title">{{item.title}}</div>
        <div class="note" v-if="item.episodesInfo">{{item.episodesInfo}}</div>
      </div>
      <div class="empty" v-if="!loading && !list.length">没有结果</div>
      <div class="douban-more" v-if="loadingMore">正在加载更多…</div>
      <div class="douban-more" v-else-if="!searchMode && list.length && !hasMore">已经到底了</div>
    </div>

    <div class="match-view zy-scroll" v-else>
      <div class="match-head">
        <button class="back" @click="closeSubject">← 返回豆瓣</button>
        <div class="subject">
          <img :src="coverSrc(selected)" @error="loadCover(selected)" />
          <div>
            <h2>{{selected.title}}</h2>
            <div class="meta">
              <span v-if="selected.year">{{selected.year}}</span>
              <span v-if="selected.rate">豆瓣 {{selected.rate}}</span>
              <span>{{selected.kind === 'tv' ? '剧集' : '电影'}}</span>
            </div>
            <div class="people" v-if="selected.directors && selected.directors.length">导演：{{selected.directors.join(' / ')}}</div>
            <div class="people" v-if="selected.casts && selected.casts.length">主演：{{selected.casts.slice(0, 8).join(' / ')}}</div>
            <p>{{selected.summary}}</p>
          </div>
        </div>
      </div>

      <div class="scan-panel">
        <div class="scan-title">
          <span>播放源匹配 · {{scanPhaseLabel}}</span>
          <span class="progress" v-if="scanState.status === 'scanning'">
            正在扫描 {{scanState.completed}} / {{scanState.total}}
          </span>
          <span class="progress" v-else>扫描完成 {{scanState.completed || scanState.total}} / {{scanState.total}}</span>
        </div>
        <div class="scan-hint">
          先完整扫描启用的 CMS；只有 CMS 没有找到可播匹配时才进入 BD/CSP fallback。BD/CSP 一旦启动会继续 exhaustive，首个可播会提前显示，最终保留 Top 5。切换 Provider 始终由你手动完成。
        </div>

        <div class="first-playable" v-if="scanState.firstPlayable && scanState.status === 'scanning'">
          首个可播：{{scanState.firstPlayable.site.name}}
        </div>

        <div class="provider-list">
          <button
            class="provider"
            v-for="(row, index) in scanState.top5"
            :key="row.site.key"
            @click="openProvider(row)">
            <span class="rank">#{{index + 1}}</span>
            <span class="provider-name">{{row.site.name}}</span>
            <span class="kind" :class="row.providerKind.toLowerCase()">{{row.providerKind}}</span>
            <span class="score">匹配 {{row.score}}</span>
            <span class="line" v-if="row.line">{{row.line}}</span>
            <span class="latency">{{row.latency}}ms</span>
            <span class="verified">✓ 已验证</span>
          </button>
        </div>

        <div class="empty" v-if="scanState.status === 'complete' && !scanState.top5.length">
          所有启用源均已扫描，没有找到同时满足身份匹配和可播放验证的 Provider。
        </div>
      </div>
    </div>
  </div>
</template>

<script>
const { ipcRenderer } = require('electron')
const { scan } = require('../lib/douban/scanner')

export default {
  name: 'Douban',
  data () {
    return {
      kind: 'movie',
      tag: '热门',
      tags: ['热门', '最新', '豆瓣高分'],
      list: [],
      loading: false,
      loadingMore: false,
      pageLimit: 30,
      nextStart: 0,
      hasMore: true,
      loadGeneration: 0,
      error: '',
      searchText: '',
      searchMode: false,
      selected: null,
      scanHandle: null,
      unsubscribe: null,
      selectionGeneration: 0,
      scanState: {
        status: 'idle',
        phase: 'cms',
        total: 0,
        completed: 0,
        cmsTotal: 0,
        cmsCompleted: 0,
        bdTotal: 0,
        bdCompleted: 0,
        firstPlayable: null,
        results: [],
        top5: []
      }
    }
  },
  computed: {
    detail: {
      get () { return this.$store.getters.getDetail },
      set (value) { this.$store.commit('SET_DETAIL', value) }
    },
    detailCache: {
      get () { return this.$store.getters.getDetailCache },
      set (value) { this.$store.commit('set_DetailCache', value) }
    },
    scanPhaseLabel () {
      if (this.scanState.phase === 'bd') return 'BD/CSP fallback'
      if (this.scanState.phase === 'cache') return '缓存结果'
      if (this.scanState.status === 'complete') return '完成'
      return 'CMS'
    }
  },
  methods: {
    async load () {
      const generation = ++this.loadGeneration
      this.loading = true
      this.loadingMore = false
      this.error = ''
      this.nextStart = 0
      this.hasMore = true
      try {
        const payload = await ipcRenderer.invoke('douban:list', {
          kind: this.kind,
          tag: this.tag,
          start: 0,
          limit: this.pageLimit
        })
        if (generation !== this.loadGeneration) return
        const rows = payload.list || []
        this.list = rows
        this.nextStart = rows.length
        this.hasMore = rows.length >= this.pageLimit
        this.searchMode = false
        this.hydrateCovers(rows)
        this.$nextTick(() => this.ensureScrollable())
      } catch (error) {
        if (generation !== this.loadGeneration) return
        this.error = '豆瓣加载失败：' + error.message
        this.list = []
        this.hasMore = false
      } finally {
        if (generation === this.loadGeneration) this.loading = false
      }
    },
    async loadMore () {
      if (this.loading || this.loadingMore || this.searchMode || this.selected || !this.hasMore) return
      const generation = this.loadGeneration
      this.loadingMore = true
      try {
        const payload = await ipcRenderer.invoke('douban:list', {
          kind: this.kind,
          tag: this.tag,
          start: this.nextStart,
          limit: this.pageLimit
        })
        if (generation !== this.loadGeneration) return
        const rows = payload.list || []
        const known = new Set(this.list.map(item => String(item.id || '')))
        const added = rows.filter(item => !known.has(String(item.id || '')))
        this.list = this.list.concat(added)
        this.nextStart += rows.length
        this.hasMore = rows.length >= this.pageLimit
        this.hydrateCovers(added)
        this.$nextTick(() => this.ensureScrollable())
      } catch (error) {
        if (generation === this.loadGeneration) this.error = '豆瓣加载更多失败：' + error.message
      } finally {
        if (generation === this.loadGeneration) this.loadingMore = false
      }
    },
    onGridScroll (event) {
      const el = event && event.currentTarget
      if (!el || this.searchMode || this.selected) return
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 420) this.loadMore()
    },
    ensureScrollable () {
      const el = this.$el && this.$el.querySelector('.douban-grid')
      if (!el || el.offsetParent === null || el.clientHeight <= 0 || this.searchMode || this.selected || !this.hasMore || this.loadingMore) return
      if (el.scrollHeight <= el.clientHeight + 80) this.loadMore()
    },
    coverSrc (item) {
      return item && (item.coverData || item.cover) || ''
    },
    async loadCover (item) {
      if (!item || !item.cover || item._coverProxyLoading || item._coverProxyTried) return
      this.$set(item, '_coverProxyLoading', true)
      this.$set(item, '_coverProxyTried', true)
      try {
        const payload = await ipcRenderer.invoke('douban:image', { url: item.cover })
        if (payload && payload.dataUrl) this.$set(item, 'coverData', payload.dataUrl)
      } catch (error) {
        // Keep the card usable even when an individual poster fails.
      } finally {
        this.$set(item, '_coverProxyLoading', false)
      }
    },
    hydrateCovers (rows) {
      const queue = (rows || []).filter(item => item && item.cover && !item.coverData && !item._coverProxyTried)
      let next = 0
      const worker = async () => {
        while (next < queue.length) {
          const item = queue[next++]
          await this.loadCover(item)
        }
      }
      const count = Math.min(4, queue.length)
      for (let i = 0; i < count; i++) worker()
    },
    changeKind (kind) {
      if (this.kind === kind && !this.searchMode) return
      this.kind = kind
      this.selected = null
      this.load()
    },
    changeTag (tag) {
      if (this.tag === tag) return
      this.tag = tag
      this.selected = null
      this.load()
    },
    async search () {
      if (!this.searchText) return this.clearSearch()
      this.loadGeneration++
      this.loadingMore = false
      this.hasMore = false
      this.loading = true
      this.error = ''
      try {
        const payload = await ipcRenderer.invoke('douban:search', { text: this.searchText })
        this.list = payload.list || []
        this.searchMode = true
        this.hydrateCovers(this.list)
        this.selected = null
      } catch (error) {
        this.error = '豆瓣搜索失败：' + error.message
      } finally {
        this.loading = false
      }
    },
    clearSearch () {
      this.loadGeneration++
      this.searchText = ''
      this.searchMode = false
      this.selected = null
      this.load()
    },
    async selectSubject (item) {
      const generation = ++this.selectionGeneration
      if (this.unsubscribe) this.unsubscribe()
      this.unsubscribe = null
      this.selected = { ...item }
      this.scanState = { status: 'scanning', phase: 'cms', total: 0, completed: 0, cmsTotal: 0, cmsCompleted: 0, bdTotal: 0, bdCompleted: 0, firstPlayable: null, results: [], top5: [] }
      this.error = ''
      try {
        const identity = await ipcRenderer.invoke('douban:detail', item)
        if (generation !== this.selectionGeneration) return
        this.selected = { ...item, ...identity }
        const handle = scan(this.selected, state => {
          if (generation !== this.selectionGeneration) return
          this.scanState = { ...state }
        })
        this.scanHandle = handle
        this.unsubscribe = handle.subscribe(state => {
          if (generation !== this.selectionGeneration) return
          this.scanState = { ...state }
        })
        handle.promise.catch(error => {
          if (generation === this.selectionGeneration) this.error = '源匹配失败：' + error.message
        })
      } catch (error) {
        if (generation === this.selectionGeneration) this.error = '豆瓣详情加载失败：' + error.message
      }
    },
    closeSubject () {
      this.selectionGeneration++
      if (this.unsubscribe) this.unsubscribe()
      this.unsubscribe = null
      this.selected = null
      this.scanHandle = null
    },
    openProvider (row) {
      if (!row || !row.site || !row.detail) return
      const id = row.detail.id || row.candidate?.id || row.candidate?.vod_id
      if (!id) return
      const key = row.site.key + '@' + id
      const cache = { ...this.detailCache, [key]: row.detail }
      this.detailCache = cache
      this.detail = {
        show: true,
        key: row.site.key,
        site: row.site,
        info: {
          id,
          ids: id,
          name: row.detail.name || this.selected.title,
          pic: row.detail.pic || this.selected.cover
        }
      }
    }
  },
  created () {
    this.load()
  },
  beforeDestroy () {
    if (this.unsubscribe) this.unsubscribe()
  }
}
</script>

<style lang="scss" scoped>
.douban-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding-top: 10px;
}
.douban-header {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 48px;
  border-bottom: 1px solid;
}
.douban-tabs,
.douban-tags,
.douban-search {
  display: flex;
  gap: 8px;
  align-items: center;
}
.douban-search {
  margin-left: auto;
}
button {
  border: 1px solid;
  background: transparent;
  border-radius: 3px;
  padding: 7px 12px;
  cursor: pointer;
  color: inherit;
}
button.active {
  font-weight: bold;
}
input {
  width: 210px;
  border: 1px solid;
  background: transparent;
  color: inherit;
  padding: 7px 10px;
  border-radius: 3px;
}
.douban-status {
  padding: 12px 0;
}
.douban-status.error {
  color: #e75b5b;
}
.douban-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
  gap: 18px;
  padding: 18px 4px 30px;
  align-content: start;
}
.douban-more {
  grid-column: 1 / -1;
  text-align: center;
  padding: 14px 0 4px;
  opacity: .65;
  font-size: 12px;
}
.douban-card {
  cursor: pointer;
  min-width: 0;
}
.poster {
  position: relative;
  height: 220px;
  overflow: hidden;
  border-radius: 4px;
  background: rgba(128, 128, 128, .15);
}
.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.poster .rate {
  position: absolute;
  right: 6px;
  bottom: 6px;
  background: rgba(0, 0, 0, .72);
  color: #ffd36b;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 12px;
}
.douban-card .title {
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.douban-card .note {
  opacity: .65;
  font-size: 12px;
  margin-top: 4px;
}
.match-view {
  flex: 1;
  overflow-y: auto;
  padding: 16px 2px 30px;
}
.back {
  margin-bottom: 14px;
}
.subject {
  display: flex;
  gap: 20px;
}
.subject img {
  width: 180px;
  height: 255px;
  object-fit: cover;
  border-radius: 4px;
}
.subject h2 {
  margin: 0 0 10px;
}
.meta {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}
.people {
  line-height: 1.7;
  opacity: .8;
}
.subject p {
  max-width: 760px;
  line-height: 1.7;
  opacity: .85;
}
.scan-panel {
  margin-top: 22px;
  border-top: 1px solid;
  padding-top: 18px;
}
.scan-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 16px;
}
.progress,
.scan-hint {
  font-size: 12px;
  opacity: .7;
}
.scan-hint {
  margin: 8px 0 12px;
}
.first-playable {
  padding: 8px 10px;
  border: 1px solid;
  border-radius: 3px;
  margin-bottom: 10px;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.provider {
  display: grid;
  grid-template-columns: 44px minmax(150px, 1fr) 60px 84px minmax(100px, 1fr) 80px 80px;
  align-items: center;
  text-align: left;
  gap: 8px;
}
.provider .kind {
  font-size: 11px;
  text-align: center;
  border: 1px solid;
  border-radius: 10px;
  padding: 2px 6px;
}
.provider .verified {
  font-size: 12px;
}
.empty {
  padding: 30px;
  text-align: center;
  opacity: .65;
  grid-column: 1 / -1;
}
</style>
