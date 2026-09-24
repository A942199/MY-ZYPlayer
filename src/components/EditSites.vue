<template>
  <div class="listpage" id="sites">
    <div class="listpage-header" v-show="!enableBatchEdit">
          <el-switch v-model="enableBatchEdit" active-text="批处理分组">></el-switch>
          <el-button @click="openFilterKeywordsDiag" icon="el-icon-key">关键词过滤</el-button>
          <el-button @click="addCmsSite" icon="el-icon-document-add">新增 CMS</el-button>
          <el-button @click="checkAllSite" icon="el-icon-refresh" :loading="checkAllSitesLoading" title="可在后台运行">检测{{ this.checkAllSitesLoading ? this.checkProgress + '/' + this.sites.length : '' }}</el-button>
          <el-button @click="resetSitesEvent" icon="el-icon-download" title="从 TV.json URL 重新下载并覆盖当前源列表">导入/更新 TV.json</el-button>
    </div>
    <div class="listpage-header" v-show="enableBatchEdit">
          <el-switch v-model="enableBatchEdit" active-text="批处理分组"></el-switch>
          <el-input placeholder="新组名" v-model="batchGroupName"></el-input>
          <el-switch v-model="batchIsActive" active-text="启用"></el-switch>
          <el-button type="primary" icon="el-icon-edit" @click.stop="saveBatchEdit" title="输入框组名为空时仅保存开关状态">保存分组与开关状态</el-button>
          <el-button @click="removeSelectedSites" icon="el-icon-delete-solid">删除</el-button>
    </div>
    <div class="listpage-body" id="sites-body">
      <div class="show-table" id="sites-table">
        <el-table size="mini" fit height="100%" row-key="id"
          ref="editSitesTable"
          :data="sites"
          @select="selectionCellClick"
          @selection-change="handleSelectionChange"
          @sort-change="handleSortChange">
          <el-table-column
            type="selection"
            v-if="enableBatchEdit">
          </el-table-column>
          <el-table-column
            prop="name"
            label="资源名">
          </el-table-column>
          <el-table-column
            label="类型"
            width="150">
            <template slot-scope="scope">
              <span>{{ isMyVideoSite(scope.row) ? 'CatVod/MyVideo' : 'CMS' }}</span>
            </template>
          </el-table-column>
          <el-table-column
            prop="isActive"
            width="120"
            :filters = "[{text:'启用', value: true}, {text:'停用', value: false}]"
            :filter-method="(value, row) => value === row.isActive"
            label="启用">
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.isActive"
                @click.native.stop='propChangeEvent(scope.row)'>
              </el-switch>
            </template>
          </el-table-column>
          <el-table-column
            prop="reverseOrder"
            width="120"
            label="倒序排列">
            <template slot-scope="scope">
              <el-switch
                v-model="scope.row.reverseOrder"
                @click.native.stop='propChangeEvent(scope.row)'>>
              </el-switch>
            </template>
          </el-table-column>
          <el-table-column
            prop="group"
            label="分组"
            :filters="getFilters"
            :filter-method="(value, row) => value === row.group"
            filter-placement="bottom-end">
          </el-table-column>
          <el-table-column
            label="状态"
            sortable
            :sort-by="['status']"
            width="120">
            <template slot-scope="scope">
              <span v-if="scope.row.status === ' '">
                <i class="el-icon-loading"></i>
                检测中...
              </span>
              <span v-else>{{scope.row.status}}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            header-align="center"
            align="right"
            :width="sites.every(site => site.status) && !checkAllSitesLoading ? 200 : 150">
            <template slot-scope="scope">
              <el-button size="mini" @click.stop="moveToTopEvent(scope.row)" type="text">置顶</el-button>
              <el-button size="mini" @click.stop="editSite(scope.row)" type="text">编辑</el-button>
              <!-- 检测时先强制批量检测一遍，如果不强制直接单个检测时第一次不会显示“检测中” -->
              <el-button size="mini" v-if="sites.every(site => site.status)" v-show="!checkAllSitesLoading" @click.stop="checkSingleSite(scope.row)" type="text">检测</el-button>
              <el-button size="mini" @click.stop="removeEvent(scope.row)" type="text">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
     </div>
    <!-- 编辑页面 -->
    <div>
      <el-dialog :visible.sync="editSiteDialogVisible" v-if='editSiteDialogVisible' :title="dialogTitle" :append-to-body="true" top="4vh" custom-class="source-edit-dialog" @close="closeDialog">
        <el-form :model="siteInfo" ref='siteInfo' label-width="75px" label-position="left" :rules="rules">
          <el-form-item label="源类型">
            <el-input :value="siteKindLabel" disabled />
          </el-form-item>
          <el-form-item label="源站名" prop='name'>
            <el-input v-model="siteInfo.name" placeholder="请输入源站名" />
          </el-form-item>
          <el-form-item label="API接口" prop='api'>
            <el-input
              v-model="siteInfo.api"
              :autosize="{ minRows: 2, maxRows: 4}"
              type="textarea"
              :placeholder="isMyVideoSite(siteInfo) ? 'CatVod / MyVideo API 标识' : '请输入 CMS API，例如 https://example.com/api.php/provide/vod/；JSON/XML 自动识别'"/>
          </el-form-item>
          <el-form-item label="JS脚本" prop='ext' v-if="isMyVideoSite(siteInfo)">
            <el-input v-model="siteInfo.ext" :autosize="{ minRows: 2, maxRows: 4}" type="textarea" placeholder="CatVod / MyVideo JS URL"/>
          </el-form-item>
          <el-form-item label="下载接口" prop='download'>
            <el-input v-model="siteInfo.download" :autosize="{ minRows: 2, maxRows: 4}" type="textarea" placeholder="请输入Download接口地址，可以空着"/>
          </el-form-item>
          <el-form-item label="解析接口" prop='jiexiUrl'>
            <el-input v-model="siteInfo.jiexiUrl" :autosize="{ minRows: 2, maxRows: 4}" type="textarea" placeholder="请输入解析接口地址，默认源自带解析,若要调用应用默认解析接口请输入默认或default"/>
          </el-form-item>
          <el-form-item label="分组" prop='group'>
            <el-select v-model="siteInfo.group" allow-create filterable default-first-option placeholder="请输入分组">
              <el-option v-for="item in siteGroup" :key="item" :label="item" :value="item"></el-option>
            </el-select>
          </el-form-item>
          <el-form-item label="源站标识" prop='key'>
            <el-input v-model="siteInfo.key" placeholder="请输入源站标识，如果为空，系统则自动生成" />
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="addOrEditSite">保存</el-button>
        </span>
      </el-dialog>
    </div>
    <!-- 设置过滤关键词页面 -->
    <div>
      <el-dialog :visible.sync="filterKeywordsDialogVisible" v-if='filterKeywordsDialogVisible' :title="'分类过滤'" :append-to-body="true" @close="closeDialog">
        <el-form>
          <el-switch v-model="excludeRootClasses" active-text="开启主分类过滤">></el-switch>
          <el-form-item>
            <el-input v-model="rootClassFilterKeywords" :autosize="{ minRows: 3, maxRows: 6}" type="textarea" placeholder="请输入过滤关键词" />
          </el-form-item>
        </el-form>
        <el-form>
          <el-switch v-model="excludeR18Films" active-text="开启福利分类过滤">></el-switch>
          <el-form-item>
            <el-input v-model="r18ClassFilterKeywords" :autosize="{ minRows: 3, maxRows: 6}" type="textarea" placeholder="请输入过滤关键词" />
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="saveFilterKeywords">保存</el-button>
        </span>
      </el-dialog>
    </div>
  </div>
</template>
<script>
import { mapMutations } from 'vuex'
import { sites, setting } from '../lib/dexie'
import zy from '../lib/site/tools'
const myvideo = require('../lib/site/myvideo')
import Sortable from 'sortablejs'

export default {
  name: 'editSites',
  data () {
    return {
      show: false,
      sites: [],
      dialogType: 'new',
      editSiteDialogVisible: false,
      filterKeywordsDialogVisible: false,
      siteInfo: {
        key: '',
        name: '',
        api: '',
        type: 0,
        ext: '',
        sourceKind: 'cms',
        network: 'native',
        download: '',
        jiexiUrl: '',
        group: 'CMS',
        isActive: true
      },
      excludeRootClasses: true,
      excludeR18Films: true,
      rootClassFilterKeywords: [],
      r18ClassFilterKeywords: [],
      siteGroup: [],
      rules: {
        name: [
          { required: true, message: '源站名不能为空', trigger: 'blur' }
        ],
        api: [
          { required: true, message: 'API地址不能为空', trigger: 'blur' }
        ]
      },
      enableBatchEdit: false,
      batchGroupName: '',
      batchIsActive: true,
      shiftDown: false,
      selectionBegin: '',
      selectionEnd: '',
      multipleSelection: [],
      checkAllSitesLoading: false,
      checkProgress: 0,
      stopFlag: false,
      editOldkey: '',
      sortable: null
    }
  },
  computed: {
    setting: {
      get () {
        return this.$store.getters.getSetting
      },
      set (val) {
        this.SET_SETTING(val)
      }
    },
    getFilters () {
      const groups = [...new Set(this.sites.map(site => site.group))]
      const filters = []
      groups.forEach(g => {
        const doc = {
          text: g,
          value: g
        }
        filters.push(doc)
      })
      return filters
    },
    dialogTitle () {
      if (this.dialogType === 'edit') {
        return this.isMyVideoSite(this.siteInfo) ? '编辑 CatVod / MyVideo 源' : '编辑 CMS 源'
      }
      return '新增 CMS 源'
    },
    siteKindLabel () {
      return this.isMyVideoSite(this.siteInfo)
        ? 'CatVod / MyVideo JS'
        : 'CMS（JSON / XML 自动识别）'
    }
  },
  watch: {
    enableBatchEdit () {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        this.enableBatchEdit = false
      }
      if (this.enableBatchEdit) {
        if (this.setting.shiftTooltipLimitTimes === undefined) this.setting.shiftTooltipLimitTimes = 5
        if (this.setting.shiftTooltipLimitTimes) {
          this.$message.info('多选时支持shift快捷键')
          this.setting.shiftTooltipLimitTimes--
          setting.find().then(res => {
            res.shiftTooltipLimitTimes = this.setting.shiftTooltipLimitTimes
            setting.update(res)
          })
        }
      }
    }
  },
  methods: {
    ...mapMutations(['SET_SETTING']),
    onShiftKeyDown (event) {
      if (event.key === 'Shift') this.shiftDown = true
    },
    onShiftKeyUp (event) {
      if (event.key === 'Shift') this.shiftDown = false
    },
    selectionCellClick (selection, row) {
      if (this.shiftDown && this.selectionBegin !== '' && selection.includes(row)) {
        this.selectionEnd = row.id
        const start = this.sites.findIndex(e => e.id === Math.min(this.selectionBegin, this.selectionEnd))
        const end = this.sites.findIndex(e => e.id === Math.max(this.selectionBegin, this.selectionEnd))
        const selections = this.sites.slice(start, end + 1)
        this.$nextTick(() => {
          selections.forEach(e => this.$refs.editSitesTable.toggleRowSelection(e, true))
        })
        this.selectionBegin = this.selectionEnd = ''
        return
      }
      if (selection.includes(row)) {
        this.selectionBegin = row.id
      } else {
        this.selectionBegin = ''
      }
    },
    handleSelectionChange (rows) {
      this.multipleSelection = rows
    },
    handleSortChange (column, prop, order) {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        return false
      }
      this.updateDatabase(this.sites)
    },
    saveBatchEdit () {
      this.multipleSelection.forEach(ele => {
        if (this.batchGroupName) {
          ele.group = this.batchGroupName
        }
        ele.isActive = this.batchIsActive
      })
      this.updateDatabase()
    },
    async getSites () {
      const rows = await sites.all()
      rows.forEach(element => {
        if (element.reverseOrder === null || element.reverseOrder === undefined) {
          element.reverseOrder = false
        }
      })
      this.sites = rows
      return rows
    },
    getSitesGroup () {
      const arr = []
      for (const i of this.sites) {
        if (arr.indexOf(i.group) < 0) {
          arr.push(i.group)
        }
      }
      this.siteGroup = arr
    },
    openFilterKeywordsDiag () {
      this.excludeRootClasses = this.setting.excludeRootClasses
      this.excludeR18Films = this.setting.excludeR18Films
      this.rootClassFilterKeywords = this.setting.rootClassFilter?.join()
      this.r18ClassFilterKeywords = this.setting.r18ClassFilter?.join()
      this.filterKeywordsDialogVisible = true
    },
    saveFilterKeywords () {
      // 移除空格,然后按逗号分开
      this.setting.rootClassFilter = this.rootClassFilterKeywords?.replace(/\s/g, '').split(',')
      this.setting.r18ClassFilter = this.r18ClassFilterKeywords?.replace(/\s/g, '').split(',')
      this.setting.classFilter = []
      this.setting.excludeRootClasses = this.excludeRootClasses
      if (this.excludeRootClasses) {
        this.setting.classFilter = this.setting.classFilter.concat(this.setting.rootClassFilter)
      }
      this.setting.excludeR18Films = this.excludeR18Films
      if (this.excludeR18Films) {
        this.setting.classFilter = this.setting.classFilter.concat(this.setting.r18ClassFilter)
      }
      setting.update(this.setting)
      this.filterKeywordsDialogVisible = false
    },
    isMyVideoSite (site) {
      if (!site) return false
      return Number(site.type) === 3 &&
        typeof site.ext === 'string' &&
        (String(site.api || '').startsWith('csp_') || /\.js(?:$|\?)/i.test(site.ext))
    },
    addCmsSite () {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        return false
      }
      this.getSitesGroup()
      this.dialogType = 'new'
      this.editSiteDialogVisible = true
      this.siteInfo = {
        key: '',
        name: '',
        api: '',
        type: 0,
        ext: '',
        sourceKind: 'cms',
        network: 'native',
        download: '',
        jiexiUrl: '',
        group: 'CMS',
        isActive: true
      }
    },
    editSite (siteInfo) {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        return false
      }
      this.getSitesGroup()
      this.dialogType = 'edit'
      this.editSiteDialogVisible = true
      this.siteInfo = { ...siteInfo }
      this.editOldkey = siteInfo.key
    },
    closeDialog () {
      this.editSiteDialogVisible = false
      this.filterKeywordsDialogVisible = false
      this.getSites()
    },
    removeEvent (e) {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        return false
      }
      sites.remove(e.id).then(res => {
        this.getSites()
      }).catch(err => {
        this.$message.warning('删除源失败, 错误信息: ' + err)
      })
    },
    checkSiteKey (e) {
      if (this.dialogType === 'edit' && this.editOldkey === this.siteInfo.key) {
        return true
      } else {
        for (const i of this.sites) {
          if (i.key === this.siteInfo.key) {
            this.$message.warning(`源站标识: ${i.key} 已存在, 请勿重复填写.`)
            return false
          }
        }
        return true
      }
    },
    async addOrEditSite () {
      if (!this.siteInfo.name || !this.siteInfo.api) {
        this.$message.error('名称和API接口不能为空。')
        return false
      }
      if (!this.checkSiteKey()) return false

      const randomstring = require('randomstring')
      const doc = {
        key: this.dialogType === 'edit' ? this.siteInfo.key : (this.siteInfo.key || randomstring.generate(6)),
        name: this.siteInfo.name,
        api: this.siteInfo.api,
        type: this.siteInfo.type,
        ext: this.siteInfo.ext,
        sourceKind: this.siteInfo.sourceKind,
        network: this.siteInfo.network || 'native',
        configUrl: this.siteInfo.configUrl,
        allowDynamicCode: this.siteInfo.allowDynamicCode === true,
        download: this.siteInfo.download,
        jiexiUrl: this.siteInfo.jiexiUrl,
        group: this.siteInfo.group,
        isActive: this.siteInfo.isActive,
        reverseOrder: Boolean(this.siteInfo.reverseOrder)
      }
      if (this.dialogType === 'edit') doc.id = this.siteInfo.id
      if (!this.isMyVideoSite(this.siteInfo)) {
        doc.type = 0
        doc.ext = ''
        doc.sourceKind = 'cms'
        doc.network = 'native'
        doc.group = doc.group || 'CMS'
      }

      try {
        await sites.put(doc)
        this.siteInfo = {
          key: '',
          name: '',
          api: '',
          type: 0,
          ext: '',
          sourceKind: 'cms',
          network: 'native',
          download: '',
          jiexiUrl: '',
          group: 'CMS',
          isActive: true
        }
        this.dialogType === 'edit' ? this.$message.success('修改成功！') : this.$message.success('新增源成功！')
        this.editSiteDialogVisible = false
        this.editOldkey = ''
        await this.getSites()
      } catch (error) {
        this.$message.error('保存源失败：' + error.message)
      }
    },
    async resetSitesEvent () {
      let url = this.setting.sitesDataURL
      if (!url) {
        url = 'https://raw.githubusercontent.com/A942199/yuan/refs/heads/main/TV.json'
      }
      try {
        const imported = await zy.getDefaultSites(url)
        if (!imported.length) return
        const existing = await sites.all()
        const merged = myvideo.mergeImportedSites(existing, imported)
        await sites.replaceAll(merged)
        this.$message.success('TV.json 导入/更新成功')
        await this.getSites()
      } catch (error) {
        this.$message.error('导入云端源站失败. ' + error)
      }
    },
    moveToTopEvent (i) {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        return false
      }
      this.sites.sort(function (x, y) { return x.key === i.key ? -1 : y.key === i.key ? 1 : 0 })
      this.updateDatabase()
    },
    syncTableData () {
      if (this.$refs.editSitesTable.tableData && this.$refs.editSitesTable.tableData.length === this.sites.length) {
        this.sites = this.$refs.editSitesTable.tableData
      }
    },
    async propChangeEvent (row) {
      await sites.put({ ...row })
      await this.getSites()
    },
    resetId (inArray) {
      let id = 1
      inArray.forEach(ele => {
        ele.id = id
        id += 1
      })
    },
    async updateDatabase () {
      this.syncTableData()
      this.sites = this.sites.map((site, index) => ({ ...site, id: index + 1 }))
      await sites.replaceAll(this.sites)
      await this.getSites()
    },
    async removeSelectedSites () {
      const selected = new Set(this.multipleSelection.map(item => item.id))
      this.sites = this.sites.filter(item => !selected.has(item.id))
      this.$refs.editSitesTable.clearFilter()
      await this.updateDatabase()
      this.enableBatchEdit = false
    },
    rowDrop () {
      if (this.checkAllSitesLoading) {
        this.$message.info('正在检测, 请勿操作.')
        return false
      }
      const tbody = document.getElementById('sites-table').querySelector('.el-table__body-wrapper tbody')
      const _this = this
      if (this.sortable) this.sortable.destroy()
      this.sortable = Sortable.create(tbody, {
        onEnd ({ newIndex, oldIndex }) {
          const currRow = _this.sites.splice(oldIndex, 1)[0]
          _this.sites.splice(newIndex, 0, currRow)
          _this.updateDatabase()
        }
      })
    },
    async checkAllSite () {
      if (this.checkAllSitesLoading) return
      this.checkAllSitesLoading = true
      this.stopFlag = false
      this.checkProgress = 0
      const uncheckedList = this.sites.filter(e => e.status === undefined || e.status === ' ') // 未检测过的优先
      const other = this.sites.filter(e => !uncheckedList.includes(e))
      await Promise.all(uncheckedList.map(site => this.checkSingleSite(site)))
      await Promise.all(other.map(site => this.checkSingleSite(site))).then(res => {
        this.checkAllSitesLoading = false
        this.getSites()
        if (!this.stopFlag) this.$message.success('视频点播源站批量检测已完成！')
      })
    },
    async checkSingleSite (row) {
      row.status = ' '
      if (this.stopFlag) {
        this.checkProgress += 1
        return row.status
      }
      const flag = await zy.check(row.key)
      this.checkProgress += 1
      if (flag) {
        row.status = '可用'
      } else {
        row.status = '失效'
        row.isActive = false
      }
      await sites.put({ ...row })
      return row.status
    }
  },
  mounted () {
    this.rowDrop()
    window.addEventListener('keydown', this.onShiftKeyDown)
    window.addEventListener('keyup', this.onShiftKeyUp)
  },
  beforeDestroy () {
    window.removeEventListener('keydown', this.onShiftKeyDown)
    window.removeEventListener('keyup', this.onShiftKeyUp)
    if (this.sortable) {
      this.sortable.destroy()
      this.sortable = null
    }
  },
  created () {
    this.getSites()
  }
}
</script>

<style>
.source-edit-dialog {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}

.source-edit-dialog .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-top: 10px;
  padding-bottom: 10px;
}

.source-edit-dialog .el-dialog__footer {
  flex: 0 0 auto;
}
</style>
