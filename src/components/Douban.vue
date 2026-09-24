<template>
  <div class="douban-page">
    <div class="japan-header" v-if="!selected">
      <div class="japan-title-row">
        <div class="japan-title">
          <div class="eyebrow">DOUBAN · JAPAN</div>
          <div class="title-line">
            <h1>日本影视</h1>
            <span class="subtitle">只看日本 / 日语相关内容</span>
          </div>
        </div>

        <div class="douban-search">
          <div class="search-box" :class="{ active: searchMode }">
            <span class="search-icon">⌕</span>
            <input v-model.trim="searchText" @keyup.enter="search" placeholder="搜索日本影视、日文标题" />
            <button class="clear-input" v-if="searchText" @click="clearSearchInput" title="清空">×</button>
          </div>
          <button class="search-action" @click="search">搜索</button>
        </div>
      </div>

      <div class="filter-row">
        <div class="category-tabs">
          <button
            v-for="section in sections"
            :key="section.key"
            :class="{ active: !searchMode && sectionKey === section.key }"
            @click="changeSection(section.key)">
            {{section.label}}
          </button>
        </div>
        <div class="sort-tabs" v-if="!searchMode">
          <span class="sort-label">排序</span>
          <button
            v-for="option in sortOptions"
            :key="option.key"
            :class="{ active: sort === option.key }"
            @click="changeSort(option.key)">
            {{option.label}}
          </button>
        </div>
        <button class="back-ranking" v-else @click="clearSearch">返回榜单</button>
      </div>

      <div class="context-line">
        <span class="context-dot"></span>
        <span v-if="searchMode">日本相关搜索：{{searchText}}</span>
        <span v-else>{{currentSection.label}} · {{currentSortLabel}}</span>
        <span class="result-count">{{list.length}} 部</span>
      </div>
    </div>

    <div class="douban-status" v-if="loading">正在加载日本影视…</div>
    <div class="douban-status error" v-else-if="error">{{error}}</div>

    <div class="douban-grid zy-scroll" v-if="!selected" @scroll.passive="onGridScroll">
      <div class="douban-card" v-for="item in list" :key="item.id" @click="selectSubject(item)">
        <div class="poster">
          <img :src="coverSrc(item)" :alt="item.title" @error="loadCover(item)" />
          <span class="section-badge">{{searchMode ? japaneseBadge(item) : currentSection.short}}</span>
          <span class="rate" v-if="item.rate">★ {{item.rate}}</span>
        </div>
        <div class="card-copy">
          <div class="title">{{item.title}}</div>
          <div class="note">
            <span v-if="item.year">{{item.year}}</span>
            <span v-if="item.episodesInfo">{{item.episodesInfo}}</span>
            <span v-if="!item.year && !item.episodesInfo">日本 / 日语</span>
          </div>
        </div>
      </div>
      <div class="empty" v-if="!loading && !list.length">
        <strong>{{searchMode ? '没有找到日本相关结果' : '当前榜单暂无数据'}}</strong>
        <span>{{searchMode ? '可以尝试日文原名或更短的关键词' : '换一个分类或排序看看'}}</span>
      </div>
      <div class="douban-more" v-if="loadingMore"><span class="loading-dot"></span>正在加载更多</div>
      <div class="douban-more end" v-else-if="!searchMode && list.length && !hasMore">— 已经到底了 —</div>
    </div>

    <div class="match-view zy-scroll" v-else>
      <div class="match-head">
        <button class="back" @click="closeSubject">← 返回{{searchMode ? '搜索结果' : currentSection.label}}</button>
        <div class="subject">
          <img :src="coverSrc(selected)" @error="loadCover(selected)" />
          <div class="subject-copy">
            <div class="eyebrow">DOUBAN · JAPAN</div>
            <h2>{{selected.title}}</h2>
            <div class="meta">
              <span v-if="selected.year">{{selected.year}}</span>
              <span class="score-chip" v-if="selected.rate">★ {{selected.rate}}</span>
              <span>{{selected.kind === 'tv' ? '剧集 / 节目' : '电影'}}</span>
              <span v-if="selected.regions && selected.regions.length">{{selected.regions.slice(0, 2).join(' / ')}}</span>
              <span v-if="selected.languages && selected.languages.length">{{selected.languages.slice(0, 2).join(' / ')}}</span>
            </div>
            <div class="people" v-if="selected.directors && selected.directors.length">导演：{{selected.directors.join(' / ')}}</div>
            <div class="people" v-if="selected.casts && selected.casts.length">主演：{{selected.casts.slice(0, 8).join(' / ')}}</div>
            <p>{{selected.summary}}</p>
            <div class="detail-warning" v-if="detailWarning">{{detailWarning}}</div>
          </div>
        </div>
      </div>

      <div class="scan-panel">
        <div class="scan-title">
          <span>播放源匹配 · {{scanPhaseLabel}}</span>
          <span class="progress" v-if="scanState.status === 'preparing'">正在准备匹配…</span>
          <span class="progress" v-else-if="scanState.status === 'scanning'">
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
      sectionKey: 'movie',
      sort: 'rank',
      sections: [
        { key: 'movie', label: '日本电影', short: '电影', kind: 'movie', tag: '日本', resultKind: 'movie' },
        { key: 'drama', label: '日剧', short: '日剧', kind: 'tv', tag: '日剧', resultKind: 'tv' },
        { key: 'anime', label: '日本动画', short: '动画', kind: 'tv', tag: '日本动画', resultKind: 'tv' },
        // Douban's legacy search_subjects endpoint exposes Japanese variety under type=movie.
        { key: 'variety', label: '日本综艺', short: '综艺', kind: 'movie', tag: '日本综艺', resultKind: 'tv' }
      ],
      sortOptions: [
        { key: 'recommend', label: '推荐' },
        { key: 'rank', label: '高分' },
        { key: 'time', label: '最新' }
      ],
      list: [],
      loading: false,
      loadingMore: false,
      pageLimit: 30,
      nextStart: 0,
      hasMore: true,
      loadGeneration: 0,
      error: '',
      detailWarning: '',
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
    currentSection () {
      return this.sections.find(section => section.key === this.sectionKey) || this.sections[0]
    },
    currentSortLabel () {
      const option = this.sortOptions.find(item => item.key === this.sort)
      return option ? option.label : '推荐'
    },
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
        const section = this.currentSection
        const payload = await ipcRenderer.invoke('douban:list', {
          kind: section.kind,
          tag: section.tag,
          sort: this.sort,
          start: 0,
          limit: this.pageLimit
        })
        if (generation !== this.loadGeneration) return
        const rows = this.normalizeRows(payload.list || [], section)
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
        const section = this.currentSection
        const payload = await ipcRenderer.invoke('douban:list', {
          kind: section.kind,
          tag: section.tag,
          sort: this.sort,
          start: this.nextStart,
          limit: this.pageLimit
        })
        if (generation !== this.loadGeneration) return
        const rows = this.normalizeRows(payload.list || [], section)
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
    normalizeRows (rows, section = this.currentSection) {
      return (rows || []).map(item => ({
        ...item,
        kind: section.resultKind || item.kind,
        sectionKey: section.key,
        sectionLabel: section.label
      }))
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
    changeSection (key) {
      if (this.sectionKey === key && !this.searchMode) return
      this.sectionKey = key
      this.searchText = ''
      this.searchMode = false
      this.selected = null
      this.load()
    },
    changeSort (sort) {
      if (this.sort === sort || this.searchMode) return
      this.sort = sort
      this.selected = null
      this.load()
    },
    clearSearchInput () {
      if (this.searchMode) return this.clearSearch()
      this.searchText = ''
    },
    japaneseBadge (item) {
      const genres = Array.isArray(item && item.genres) ? item.genres : []
      if (genres.some(value => /(?:真人秀|脱口秀|综艺)/.test(value))) return '综艺'
      if (genres.some(value => /动画/.test(value))) return '动画'
      if (item && item.kind === 'tv') return '日剧'
      return '日本'
    },
    async search () {
      if (!this.searchText) return this.clearSearch()
      this.loadGeneration++
      this.loadingMore = false
      this.hasMore = false
      this.loading = true
      this.error = ''
      try {
        const payload = await ipcRenderer.invoke('douban:search', { text: this.searchText, japanOnly: true })
        this.list = payload.list || []
        this.searchMode = true
        this.hydrateCovers(this.list)
        this.selected = null
      } catch (error) {
        this.list = []
        this.searchMode = true
        this.selected = null
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
      this.scanHandle = null
      this.selected = { ...item }
      this.scanState = { status: 'preparing', phase: 'cms', total: 0, completed: 0, cmsTotal: 0, cmsCompleted: 0, bdTotal: 0, bdCompleted: 0, firstPlayable: null, results: [], top5: [] }
      this.error = ''
      this.detailWarning = ''

      let identity = { ...item }
      try {
        const enriched = await ipcRenderer.invoke('douban:detail', item)
        if (generation !== this.selectionGeneration) return
        identity = { ...item, ...enriched }
        if (enriched && enriched.detailStatus && enriched.detailStatus !== 'full') {
          this.detailWarning = enriched.detailStatus === 'partial'
            ? '豆瓣详情暂不完整，已使用搜索指纹和现有信息继续匹配播放源。'
            : '豆瓣详情暂时不可用，已使用现有信息继续匹配播放源。'
        }
      } catch (error) {
        if (generation !== this.selectionGeneration) return
        identity = { ...item, detailStatus: 'degraded', detailError: error.message }
        this.detailWarning = '豆瓣详情暂时不可用，已使用现有信息继续匹配播放源。'
      }

      if (generation !== this.selectionGeneration) return
      this.selected = identity
      this.startSubjectScan(identity, generation)
    },
    startSubjectScan (identity, generation) {
      try {
        const handle = scan(identity, state => {
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
        if (generation === this.selectionGeneration) this.error = '源匹配启动失败：' + error.message
      }
    },
    closeSubject () {
      this.selectionGeneration++
      if (this.unsubscribe) this.unsubscribe()
      this.unsubscribe = null
      this.selected = null
      this.scanHandle = null
      this.detailWarning = ''
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
$accent: #32d583;
$accent-soft: rgba(50, 213, 131, .14);
$line: rgba(127, 127, 127, .22);
$surface: rgba(127, 127, 127, .08);

.douban-page {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.japan-header {
  flex: 0 0 auto;
  padding: 16px 18px 10px;
  border-bottom: 1px solid $line;
  background: linear-gradient(180deg, rgba(50, 213, 131, .055), transparent 72%);
}
.japan-title-row,
.filter-row,
.context-line {
  display: flex;
  align-items: center;
}
.japan-title-row {
  min-height: 48px;
  gap: 18px;
}
.japan-title {
  min-width: 220px;
}
.eyebrow {
  color: $accent;
  font-size: 10px;
  line-height: 1;
  font-weight: 800;
  letter-spacing: .16em;
  text-transform: uppercase;
}
.title-line {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-top: 5px;
}
.title-line h1 {
  margin: 0;
  font-size: 23px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: .02em;
}
.subtitle {
  font-size: 12px;
  opacity: .58;
  white-space: nowrap;
}
.douban-search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.search-box {
  width: min(330px, 32vw);
  height: 36px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid $line;
  border-radius: 10px;
  background: $surface;
  transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
.search-box:focus-within,
.search-box.active {
  border-color: rgba(50, 213, 131, .62);
  box-shadow: 0 0 0 2px rgba(50, 213, 131, .08);
  background: rgba(50, 213, 131, .055);
}
.search-icon {
  font-size: 17px;
  line-height: 1;
  opacity: .55;
}
.search-box input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: inherit;
  font-size: 13px;
}
.search-box input::placeholder {
  color: inherit;
  opacity: .42;
}
button {
  border: 1px solid $line;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
}
button:hover {
  border-color: rgba(50, 213, 131, .5);
}
.clear-input {
  width: 23px;
  height: 23px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  font-size: 17px;
  line-height: 20px;
  opacity: .55;
}
.clear-input:hover {
  opacity: 1;
  background: rgba(127, 127, 127, .15);
}
.search-action {
  height: 36px;
  padding: 0 15px;
  border-color: rgba(50, 213, 131, .5);
  border-radius: 10px;
  background: $accent-soft;
  color: $accent;
  font-weight: 700;
}
.search-action:hover {
  background: rgba(50, 213, 131, .2);
}
.filter-row {
  min-height: 48px;
  gap: 14px;
  margin-top: 8px;
}
.category-tabs,
.sort-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
}
.category-tabs {
  flex-wrap: wrap;
}
.category-tabs button {
  padding: 7px 13px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 650;
}
.category-tabs button.active {
  color: $accent;
  border-color: rgba(50, 213, 131, .52);
  background: $accent-soft;
}
.sort-tabs {
  margin-left: auto;
  padding: 3px;
  border: 1px solid $line;
  border-radius: 10px;
  background: $surface;
}
.sort-label {
  padding: 0 5px 0 7px;
  font-size: 11px;
  opacity: .45;
}
.sort-tabs button {
  padding: 5px 9px;
  border: 0;
  border-radius: 7px;
  font-size: 12px;
  opacity: .7;
}
.sort-tabs button.active {
  color: $accent;
  background: rgba(50, 213, 131, .14);
  opacity: 1;
  font-weight: 700;
}
.back-ranking {
  margin-left: auto;
  padding: 7px 12px;
  border-radius: 9px;
  color: $accent;
}
.context-line {
  min-height: 24px;
  gap: 7px;
  font-size: 11px;
  opacity: .62;
}
.context-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: $accent;
  box-shadow: 0 0 0 3px rgba(50, 213, 131, .12);
}
.result-count {
  margin-left: 2px;
  padding-left: 8px;
  border-left: 1px solid $line;
}
.douban-status {
  flex: 0 0 auto;
  padding: 10px 18px 0;
  font-size: 12px;
  opacity: .7;
}
.douban-status.error {
  color: #e75b5b;
  opacity: 1;
}
.douban-grid {
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 20px 18px;
  padding: 16px 18px 32px;
  align-content: start;
}
.douban-card {
  min-width: 0;
  cursor: pointer;
}
.poster {
  position: relative;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border: 1px solid rgba(127, 127, 127, .16);
  border-radius: 10px;
  background: rgba(127, 127, 127, .13);
  box-shadow: 0 8px 20px rgba(0, 0, 0, .08);
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
}
.douban-card:hover .poster {
  transform: translateY(-3px);
  border-color: rgba(50, 213, 131, .38);
  box-shadow: 0 12px 26px rgba(0, 0, 0, .16);
}
.poster::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 30%;
  pointer-events: none;
  background: linear-gradient(transparent, rgba(0, 0, 0, .38));
}
.poster img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  transition: transform .22s ease;
}
.douban-card:hover .poster img {
  transform: scale(1.018);
}
.section-badge,
.poster .rate {
  position: absolute;
  z-index: 1;
  border-radius: 6px;
  backdrop-filter: blur(8px);
  font-size: 11px;
  font-weight: 700;
}
.section-badge {
  left: 7px;
  top: 7px;
  padding: 4px 7px;
  background: rgba(17, 25, 22, .74);
  color: #d9ffe9;
  border: 1px solid rgba(50, 213, 131, .28);
}
.poster .rate {
  right: 7px;
  bottom: 7px;
  padding: 4px 7px;
  background: rgba(0, 0, 0, .72);
  color: #ffd36b;
}
.card-copy {
  padding: 8px 2px 0;
}
.douban-card .title {
  overflow: hidden;
  color: inherit;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.douban-card .note {
  display: flex;
  gap: 7px;
  min-height: 17px;
  margin-top: 3px;
  font-size: 11px;
  opacity: .52;
}
.douban-more {
  grid-column: 1 / -1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 14px 0 2px;
  font-size: 12px;
  opacity: .62;
}
.douban-more.end {
  letter-spacing: .08em;
  opacity: .42;
}
.loading-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: $accent;
  animation: douban-pulse 1s infinite alternate;
}
@keyframes douban-pulse {
  from { opacity: .3; transform: scale(.8); }
  to { opacity: 1; transform: scale(1.1); }
}
.empty {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 56px 24px;
  text-align: center;
  opacity: .62;
}
.empty strong {
  font-size: 14px;
}
.empty span {
  font-size: 12px;
  opacity: .7;
}
.match-view {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px 34px;
}
.match-head {
  max-width: 1080px;
}
.back {
  margin-bottom: 16px;
  padding: 7px 12px;
  border-radius: 9px;
  color: $accent;
}
.subject {
  display: flex;
  gap: 22px;
  padding: 16px;
  border: 1px solid $line;
  border-radius: 14px;
  background: $surface;
}
.subject img {
  width: 168px;
  height: 238px;
  flex: 0 0 auto;
  object-fit: cover;
  border-radius: 10px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, .14);
}
.subject-copy {
  min-width: 0;
  padding-top: 3px;
}
.subject h2 {
  margin: 7px 0 10px;
  font-size: 24px;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 12px;
}
.meta span {
  padding: 4px 7px;
  border: 1px solid $line;
  border-radius: 7px;
  font-size: 11px;
  opacity: .72;
}
.meta .score-chip {
  color: #ffd36b;
  border-color: rgba(255, 211, 107, .3);
  background: rgba(255, 211, 107, .08);
  opacity: 1;
}
.people {
  max-width: 780px;
  font-size: 12px;
  line-height: 1.7;
  opacity: .7;
}
.subject p {
  max-width: 800px;
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.75;
  opacity: .82;
}
.detail-warning {
  max-width: 800px;
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 211, 107, .28);
  border-radius: 8px;
  background: rgba(255, 211, 107, .07);
  color: #d6aa42;
  font-size: 11px;
  line-height: 1.55;
}
.scan-panel {
  max-width: 1080px;
  margin-top: 20px;
  padding: 18px;
  border: 1px solid $line;
  border-radius: 14px;
  background: rgba(127, 127, 127, .045);
}
.scan-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-size: 15px;
  font-weight: 800;
}
.progress,
.scan-hint {
  font-size: 11px;
  opacity: .62;
}
.scan-hint {
  margin: 8px 0 14px;
  line-height: 1.6;
}
.first-playable {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(50, 213, 131, .35);
  border-radius: 8px;
  background: $accent-soft;
  color: $accent;
  font-size: 12px;
}
.provider-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.provider {
  display: grid;
  grid-template-columns: 44px minmax(150px, 1fr) 60px 84px minmax(100px, 1fr) 80px 80px;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  text-align: left;
}
.provider:hover {
  background: rgba(50, 213, 131, .07);
}
.provider .kind {
  padding: 2px 6px;
  border: 1px solid;
  border-radius: 10px;
  font-size: 10px;
  text-align: center;
}
.provider .verified {
  color: $accent;
  font-size: 11px;
}
@media (max-width: 980px) {
  .japan-title .subtitle {
    display: none;
  }
  .search-box {
    width: 240px;
  }
  .category-tabs button {
    padding: 7px 10px;
  }
  .provider {
    grid-template-columns: 40px minmax(120px, 1fr) 55px 70px 70px;
  }
  .provider .line,
  .provider .latency {
    display: none;
  }
}
</style>
