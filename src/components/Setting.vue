<template>
  <div class="setting">
    <div class="setting-box zy-scroll">
      <div class="logo"><img src="@/assets/image/logo.png" alt=""></div>
      <div class="info">
        <a @click="linkOpen('http://zyplayer.fun/')">官网</a>
        <a @click="linkOpen('https://github.com/Hunlongyu/ZY-Player')">Github</a>
        <a @click="linkOpen('https://github.com/Hunlongyu/ZY-Player/discussions/776')">软件完全免费，如遇收费，请立即给差评并退费！</a>
        <a style="color:#38dd77" @click="openUpdate()" v-show="update.find" >最新版本v{{update.version}}</a>
      </div>
      <div class="shortcut">
        <div class="title">快捷键</div>
        <div class="shortcut-box">
          <div class="zy-select" @mouseleave="show.shortcut = false">
            <div class="vs-placeholder" @click="show.shortcut = true">快捷键</div>
            <div class="vs-options" v-show="show.shortcut">
              <ul class="zy-scroll">
                <li :class="d.shortcut === true ? 'active' : ''" @click="changeShortcut(true)">开启</li>
                <li :class="d.shortcut === false ? 'active' : ''" @click="changeShortcut(false)">关闭</li>
              </ul>
            </div>
          </div>
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="expShortcut">导出</div>
          </div>
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="impShortcut">导入</div>
          </div>
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="resetShortcut">重置</div>
          </div>
        </div>
      </div>
      <div class="shortcut" title="清理缓存后图片资源需重新下载，不建议清理，软件会根据磁盘空间动态管理缓存大小">
        <div class="title">缓存</div>
        <div class="shortcut-box">
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="clearCache">清理缓存</div>
          </div>
        </div>
      </div>
      <div class="site">
        <div class="title">定位时间设置</div>
        <div class="zy-input">
          左/右方向键:<input style="width:50px" type="number" v-model = "d.forwardTimeInSec" @change="updateSettingEvent">秒
        </div>
      </div>
      <div class="site">
        <div class="title">源管理</div>
        <div class="site-box">
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="editSitesEvent">打开源管理</div>
          </div>
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="show.configDefaultParseUrlDialog = true">设置默认解析接口</div>
          </div>
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="show.configSitesDataUrlDialog = true">TV.json 地址</div>
          </div>
        </div>
      </div>
      <div class="site">
        <div class="title">网络</div>
        <div class="site-box">
          <div class="zy-select" @mouseleave="show.proxy = false">
            <div class="vs-placeholder" @click="show.proxy = true">代理设置</div>
            <div class="vs-options" v-if="show.proxy">
              <ul class="zy-scroll">
                <li :class="d.proxy.type === 'none' ? 'active' : ''" @click="changeProxyType('none')">不使用代理</li>
                <!-- <li :class="d.proxy.type === 'system' ? 'active' : ''" @click="changeProxyType('system')">使用系统代理</li> -->
                <li :class="d.proxy.type === 'manual' ? 'active' : ''" @click="changeProxyType('manual')">手动指定代理</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div class="site">
        <div class="title">字幕与弹幕</div>
        <div class="site-box media-enhancement-settings">
          <div class="zy-input">
            <input type="checkbox" v-model="d.mediaEnhancement.danmakuEnabled" @change="saveMediaEnhancementQuick"> 默认开启弹幕
            <span>字幕默认关闭（播放时手动开启）</span>
          </div>
          <div class="zy-select">
            <div class="vs-placeholder vs-noAfter" @click="openMediaEnhancementDialog">MyVideo 服务设置</div>
          </div>
          <div class="media-enhancement-note">字幕仅允许日本語 / 日中双语；字幕默认关闭时不会发送字幕请求。</div>
        </div>
      </div>
      <div class="site">
        <div class="title">窗口及播放</div>
        <div class="site-box">
          <div class="zy-input">
            <input type="checkbox" v-model = "d.restoreWindowPositionAndSize" @change="updateSettingEvent"> 记录并恢复窗口位置和大小
            <input type="checkbox" v-model = "d.pauseWhenMinimize" @change="updateSettingEvent"> 最小化时暂停播放
          </div>
        </div>
      </div>
      <div class="theme">
        <div class="title">主题</div>
        <div class="theme-box">
          <div @click="changeTheme('light')" class="theme-item light">
            <div class="theme-image">
              <img src="../assets/image/light.png" alt="">
            </div>
            <div class="theme-name">Light</div>
          </div>
          <div @click="changeTheme('dark')" class="theme-item dark">
            <div class="theme-image">
              <img src="../assets/image/dark.png" alt="">
            </div>
            <div class="theme-name">Dark</div>
          </div>
          <div @click="changeTheme('green')" class="theme-item green">
            <div class="theme-image">
              <img src="../assets/image/green.png" alt="">
            </div>
            <div class="theme-name">Green</div>
          </div>
          <div @click="changeTheme('pink')" class="theme-item pink">
            <div class="theme-image">
              <img src="../assets/image/pink.png" alt="">
            </div>
            <div class="theme-name">Pink</div>
          </div>
        </div>
      </div>
      <div class="clearDB">
        <span @click="clearDBEvent" class="clearBtn">软件重置</span>
        <span @click="changePasswordEvent" class="clearBtn">设置密码</span>
        <div class="clearTips">如果新安装用户, 无法显示资源, 请点击软件重置. 如非必要, 切勿点击. 会清空用户数据, 恢复默认设置. 点击即软件重置, 并关闭软件.</div>
      </div>
      <div class="Tips">
        <span>所有资源来自网上, 该软件不参与任何制作, 上传, 储存等内容, 禁止传播违法资源. 该软件仅供学习参考, 请于安装后24小时内删除.</span>
      </div>
    </div>
    <div> <!-- 设置默认解析接口 -->
      <el-dialog :visible.sync="show.configDefaultParseUrlDialog" v-if='show.configDefaultParseUrlDialog' title="设置默认解析接口" :append-to-body="true" @close="closeDialog">
        <el-form label-width="45px" label-position="left">
          <el-form-item label="URL:">
            <el-input v-model="setting.defaultParseURL" :autosize="{ minRows: 2, maxRows: 4}" type="textarea" placeholder="请输入解析接口地址，为空时会自动设置，重置时会自动更新默认接口地址"/>
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="danger" @click="resetDefaultParseURL">重置</el-button>
          <el-button type="primary" @click="configDefaultParseURL">确定</el-button>
        </span>
      </el-dialog>
    </div>
    <div> <!-- 设置 TV.json 地址 -->
      <el-dialog :visible="show.configSitesDataUrlDialog" v-if='show.configSitesDataUrlDialog' title="TV.json 地址" :append-to-body="true" @close="closeDialog">
        <el-form label-width="45px" label-position="left">
          <el-form-item label="URL:">
            <el-input v-model="setting.sitesDataURL" :autosize="{ minRows: 2, maxRows: 4}" type="textarea" placeholder="请输入 TV.json URL；默认使用 A942199/yuan/TV.json"/>
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="danger" @click="resetDefaultSitesDataURL">重置</el-button>
          <el-button type="primary" @click="configSitesDataURL">确定</el-button>
        </span>
      </el-dialog>
    </div>
    <div> <!-- MyVideo 字幕/弹幕服务 -->
      <el-dialog :visible.sync="show.mediaEnhancementDialog" v-if="show.mediaEnhancementDialog" title="MyVideo 字幕/弹幕服务" :append-to-body="true" @close="closeDialog" width="520px">
        <el-form label-width="90px" label-position="left" size="small">
          <el-form-item label="服务地址">
            <el-input v-model="mediaEnhancementDraft.baseUrl" placeholder="https://video.zi-quan.com" />
          </el-form-item>
          <el-form-item label="访问密码">
            <el-input v-model="mediaEnhancementDraft.password" type="password" show-password placeholder="MyVideo ACCESS_PASSWORD" />
          </el-form-item>
          <div class="media-enhancement-dialog-note">播放器通过 MyVideo 的 /api/danmaku/resolve 与 /api/subtitles/resolve 使用现有多源匹配、缓存和字幕语言策略。密码仅保存在本机设置数据库。</div>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="danger" @click="resetMediaEnhancementService">重置</el-button>
          <el-button type="primary" @click="saveMediaEnhancementService">确定</el-button>
        </span>
      </el-dialog>
    </div>
    <div> <!-- 输入密码页面 -->
      <el-dialog :visible.sync="show.checkPasswordDialog" v-if='show.checkPasswordDialog' :append-to-body="true" @close="closeDialog" width="300px">
        <el-form label-width="75px" label-position="left">
          <el-form-item label="当前密码" prop='name'>
            <el-input v-model="inputPassword" placeholder="请输入您的当前密码" />
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="checkPasswordEvent">确定</el-button>
        </span>
      </el-dialog>
    </div>
    <div> <!-- 修改密码页面 -->
      <el-dialog :visible.sync="show.changePasswordDialog" v-if='show.changePasswordDialog' :append-to-body="true" @close="closeDialog" width="300px">
        <el-form label-width="75px" label-position="left">
          <el-form-item label="新密码" prop='name'>
            <el-input v-model="inputPassword" placeholder="请输入您的新密码" />
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="confirmedChangePasswordEvent">确定</el-button>
        </span>
      </el-dialog>
    </div>
    <div> <!-- 代理设置界面 -->
      <el-dialog :visible.sync="show.proxyDialog" :append-to-body="true" @close="closeDialog" width="400px">
        <el-form label-width="50px" label-position="left" size="small">
          <el-form-item label="协议: " prop='scheme'>
            <el-col :span="15">
              <el-select v-model="proxy.scheme" placeholder="请选择协议类型">
                <el-option label="http" value="http"></el-option>
                <el-option label="socks5" value="socks5"></el-option>
              </el-select>
            </el-col>
          </el-form-item>
          <el-form-item label="地址: " prop='url'>
            <el-col :span="15">
              <el-input v-model="proxy.url" placeholder="地址" />
            </el-col>
            <el-col class="line" :span="2" style="text-align: center;">:</el-col>
            <el-col :span="7">
              <el-input v-model="proxy.port" placeholder="端口" width="80px" />
            </el-col>
          </el-form-item>
        </el-form>
        <span slot="footer" class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="proxyConfirm">确定</el-button>
        </span>
      </el-dialog>
    </div>
    <div class="update" v-if="update.show">
      <div class="wrapper">
        <div class="body">
          <div class="content" v-html="update.html"></div>
        </div>
        <div class="footer">
          <el-button size="small" @click="closeUpdate">关闭</el-button>
          <el-button size="small" v-show="update.showDownload" @click="startUpdate">更新</el-button>
          <el-button size="small" v-show="!update.showDownload && !update.downloaded">正在更新...</el-button>
          <el-button size="small" v-show="update.downloaded" @click="installUpdate">安装</el-button>
        </div>
      </div>
    </div>
  </div>
</template>
<script>
import { mapMutations } from 'vuex'
import pkg from '../../package.json'
import { setting, sites, shortcut } from '../lib/dexie'
import { localKey as defaultShortcuts } from '../lib/dexie/initData'
import { shell, clipboard, ipcRenderer } from 'electron'
const remote = require('@electron/remote')
import db from '../lib/dexie/dexie'
import zy from '../lib/site/tools'
const { normalizeMediaEnhancementConfig } = require('../lib/player/media-enhancement')
export default {
  name: 'setting',
  data () {
    return {
      pkg: pkg,
      shortcutList: [],
      show: {
        site: false,
        shortcut: false,
        view: false,
        checkPasswordDialog: false,
        changePasswordDialog: false,
        proxy: false,
        proxyDialog: false,
        configDefaultParseUrlDialog: false,
        configSitesDataUrlDialog: false,
        mediaEnhancementDialog: false
      },
      d: { },
      latestVersion: pkg.version,
      inputPassword: '',
      action: '',
      proxy: {
        type: '',
        scheme: '',
        url: '',
        port: ''
      },
      mediaEnhancementDraft: normalizeMediaEnhancementConfig(),
      update: {
        find: false,
        version: '',
        show: false,
        html: '',
        downloaded: false,
        showDownload: true
      }
    }
  },
  computed: {
    view: {
      get () {
        return this.$store.getters.getView
      },
      set (val) {
        this.SET_VIEW(val)
      }
    },
    setting: {
      get () {
        return this.$store.getters.getSetting
      },
      set (val) {
        this.SET_SETTING(val)
      }
    }
  },
  methods: {
    ...mapMutations(['SET_SETTING', 'SET_VIEW']),
    linkOpen (e) {
      shell.openExternal(e)
    },
    getSetting () {
      setting.find().then(async res => {
        res = res || { id: 0 }
        const normalized = normalizeMediaEnhancementConfig(res.mediaEnhancement)
        res.mediaEnhancement = normalized
        this.d = res
        this.setting = this.d
        await setting.update({ mediaEnhancement: normalized })
        if (!this.setting.defaultParseURL) this.configDefaultParseURL()
        if (!this.setting.sitesDataURL) this.resetDefaultSitesDataURL()
      })
    },
    async getDefaultSites () {
      const s = await setting.find()
      zy.getDefaultSites(s.sitesDataURL).then(res => {
        if (res && typeof res === 'string') {
          const json = JSON.parse(res)
          return sites.replaceAll(json)
        }
        if (res && typeof res === 'object') {
          return sites.replaceAll(res)
        }
      }).catch(error => {
        this.$message.error('获取云端源站失败. ' + error)
      })
    },
    getSites () {
      sites.all().then(res => {
        if (res.length <= 0) {
          this.$message.warning('检测到视频源未能正常加载, 即将重置源.')
          this.getDefaultSites()
        }
      })
    },
    getShortcut () {
      shortcut.all().then(res => {
        this.shortcutList = res
      })
    },
    async clearCache () {
      const win = remote.getCurrentWindow()
      const ses = win.webContents.session
      const size = await ses.getCacheSize() / 1024 / 1024
      const mb = size.toFixed(2)
      await ses.clearCache()
      this.$message.success(`清除缓存成功, 共清理 ${mb} MB`)
    },
    updateSettingEvent () {
      this.setting = this.d
      return setting.update(this.d)
    },
    toggleExcludeR18Films () {
      this.d.excludeR18Films = !this.d.excludeR18Films
      this.updateSettingEvent()
    },
    toggleExcludeRootClasses () {
      this.d.excludeRootClasses = !this.d.excludeRootClasses
      this.updateSettingEvent()
    },
    async resetDefaultParseURL () {
      this.setting.defaultParseURL = 'https://jx.bpba.cc/?v='
    },
    async configDefaultParseURL () {
      if (!this.setting.defaultParseURL) await this.resetDefaultParseURL()
      this.d.defaultParseURL = this.setting.defaultParseURL?.trim()
      this.show.configDefaultParseUrlDialog = false
      this.updateSettingEvent()
    },
    resetDefaultSitesDataURL () {
      this.setting.sitesDataURL = 'https://raw.githubusercontent.com/A942199/yuan/refs/heads/main/TV.json'
    },
    configSitesDataURL () {
      if (!this.setting.sitesDataURL) this.resetDefaultSitesDataURL()
      this.d.sitesDataURL = this.setting.sitesDataURL
      this.show.configSitesDataUrlDialog = false
      this.updateSettingEvent()
    },
    editSitesEvent () {
      if (this.d.password) {
        this.action = 'EditSites'
        this.show.checkPasswordDialog = true
      } else {
        this.view = 'EditSites'
      }
    },
    openMediaEnhancementDialog () {
      this.mediaEnhancementDraft = normalizeMediaEnhancementConfig(this.d.mediaEnhancement)
      this.show.mediaEnhancementDialog = true
    },
    async saveMediaEnhancementQuick () {
      this.d.mediaEnhancement = normalizeMediaEnhancementConfig(this.d.mediaEnhancement)
      await this.updateSettingEvent()
    },
    async saveMediaEnhancementService () {
      const normalized = normalizeMediaEnhancementConfig({
        ...this.d.mediaEnhancement,
        baseUrl: this.mediaEnhancementDraft.baseUrl,
        password: this.mediaEnhancementDraft.password
      })
      this.d.mediaEnhancement = normalized
      await this.updateSettingEvent()
      this.show.mediaEnhancementDialog = false
      this.$message.success('字幕/弹幕服务设置已保存')
    },
    resetMediaEnhancementService () {
      this.mediaEnhancementDraft = normalizeMediaEnhancementConfig({
        ...this.d.mediaEnhancement,
        baseUrl: 'https://video.zi-quan.com',
        password: ''
      })
    },
    async closeDialog () {
      this.show.checkPasswordDialog = false
      this.show.changePasswordDialog = false
      this.show.configDefaultParseUrlDialog = false
      this.show.configSitesDataUrlDialog = false
      this.show.mediaEnhancementDialog = false
      if (this.show.proxyDialog) {
        this.show.proxyDialog = false
        this.proxy = { ...(this.d.proxy || { type: 'none', scheme: '', url: '', port: '' }) }
      }
      this.inputPassword = ''
    },
    checkPasswordEvent () {
      if (this.inputPassword === this.d.password) {
        this.closeDialog()
        if (this.action === 'EditSites') {
          this.view = 'EditSites'
        } else if (this.action === 'ChangePassword') {
          this.show.changePasswordDialog = true
        } else if (this.action === 'CleanDB') {
          this.clearDB()
        }
      } else {
        this.$message.error('您输入的密码错误，请重试')
      }
    },
    changePasswordEvent () {
      if (this.d.password) {
        this.action = 'ChangePassword'
        this.show.checkPasswordDialog = true
      } else {
        this.show.changePasswordDialog = true
      }
    },
    confirmedChangePasswordEvent () {
      this.d.password = this.inputPassword
      this.updateSettingEvent()
      this.closeDialog()
    },
    changeTheme (e) {
      this.d.theme = e
      this.updateSettingEvent()
    },
    changeShortcut (e) {
      this.d.shortcut = e
      this.updateSettingEvent()
      this.show.shortcut = false
    },
    expShortcut () {
      const arr = [...this.shortcutList]
      const str = JSON.stringify(arr, null, 2)
      clipboard.writeText(str)
      this.$message.success('已复制到剪贴板')
    },
    impShortcut () {
      try {
        const str = clipboard.readText()
        const json = JSON.parse(str)
        const rows = Array.isArray(json) ? json : [json]
        shortcut.clear().then(() => shortcut.add(rows)).then(() => {
          this.$message.success('快捷键已导入')
          this.getShortcut()
          this.d.shortcutModified = true
          this.updateSettingEvent()
        }).catch(error => this.$message.error('快捷键导入失败：' + error.message))
      } catch (error) {
        this.$message.error('剪贴板内容不是有效的快捷键 JSON：' + error.message)
      }
    },
    resetShortcut () {
      shortcut.clear().then(shortcut.add(defaultShortcuts)).then(res => {
        this.getShortcut()
        this.$message.success('快捷键已重置')
        this.d.shortcutModified = true
        this.updateSettingEvent()
      })
    },
    async changeProxyType (e) {
      this.show.proxy = false
      if (e === 'manual') {
        this.proxy = {
          type: 'manual',
          scheme: this.d.proxy && this.d.proxy.scheme ? this.d.proxy.scheme : 'http',
          url: this.d.proxy && this.d.proxy.url ? this.d.proxy.url : '',
          port: this.d.proxy && this.d.proxy.port ? this.d.proxy.port : ''
        }
        this.show.proxyDialog = true
        return
      }

      this.d.proxy = { ...(this.d.proxy || {}), type: e }
      await this.updateSettingEvent()
      zy.proxy()
    },
    async proxyConfirm () {
      if (!this.proxy.scheme || !this.proxy.url || !this.proxy.port) {
        this.$message.error('请完整填写代理协议、地址和端口')
        return
      }
      this.d.proxy = {
        type: 'manual',
        scheme: this.proxy.scheme,
        url: this.proxy.url.trim(),
        port: String(this.proxy.port).trim()
      }
      await this.updateSettingEvent()
      this.show.proxyDialog = false
      zy.proxy()
      this.$message.info('开始使用代理')
    },
    clearDBEvent () {
      if (this.d.password) {
        this.action = 'CleanDB'
        this.show.checkPasswordDialog = true
      } else {
        this.clearDB()
      }
    },
    clearDB () {
      db.delete().then(res => {
        this.$message.success('重置成功')
        const win = remote.getCurrentWindow()
        win.destroy()
      })
    },
    openDoc (e) {
      if (e === 'sites') {
        this.linkOpen('http://zyplayer.fun/doc/sites/')
        return false
      }
      if (e === 'shortcut') {
        this.linkOpen('http://zyplayer.fun/doc/shortcut/')
        return false
      }
    },
    checkUpdate () {
      ipcRenderer.send('checkForUpdate')
      ipcRenderer.on('update-available', (e, info) => {
        this.update.find = true
        this.update.version = info.version
        this.update.html = info.releaseNotes
      })
    },
    openUpdate () {
      this.update.show = true
    },
    closeUpdate () {
      this.update.show = false
    },
    startUpdate () {
      this.update.showDownload = false
      ipcRenderer.send('downloadUpdate')
      ipcRenderer.on('update-downloaded', () => {
        this.update.downloaded = true
        this.$message.success('更新已下载完成！Mac用户须手动点击“安装”，其它系统会在退出后自动安装')
      })
    },
    installUpdate () {
      ipcRenderer.send('quitAndInstall')
    },
    createContextMenu () {
      const { Menu, MenuItem } = remote
      const menu = new Menu()
      menu.append(new MenuItem({ label: '快速复制', role: 'copy' }))
      menu.append(new MenuItem({ label: '快速粘贴', role: 'paste' }))
      menu.append(new MenuItem({ label: '编辑', role: 'editMenu' }))
      window.addEventListener('contextmenu', e => {
        e.preventDefault()
        menu.popup(remote.getCurrentWindow())
      })
    }
  },
  created () {
    // this.getSites()
    this.getSetting()
    this.getShortcut()
    this.createContextMenu()
  }
}
</script>
<style lang="scss" scoped>
.setting{
  height: calc(100% - 40px);
  width: 100%;
  border-radius: 5px;
  padding: 20px 0;
  .setting-box{
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .logo{
    margin-top: 10px;
    width: 100%;
    text-align: center;
    img{
      width: 120px;
      height: auto;
    }
  }
  .info{
    width: 100%;
    margin-top: 20px;
    text-align: center;
    a{
      text-decoration: none;
      margin: 0 10px;
      font-size: 14px;
      cursor: pointer;
    }
  }
  .media-enhancement-settings{
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    .zy-input{
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .media-enhancement-note{
      width: 100%;
      margin-top: 4px;
      font-size: 12px;
      opacity: .68;
    }
  }
  .media-enhancement-dialog-note{
    font-size: 12px;
    line-height: 1.6;
    opacity: .68;
  }
  .site{
    width: 100%;
    padding: 20px;
    margin-top: 20px;
    .site-box{
      margin-top: 10px;
      .zy-select{
        margin-right: 20px;
      }
    }
  }
  .shortcut{
    width: 100%;
    padding: 20px;
    margin-top: 20px;
    .shortcut-box{
      margin-top: 10px;
      .zy-select{
        margin-right: 20px;
      }
    }
  }
  .theme{
    width: 100%;
    padding-left: 20px;
    margin-top: 20px;
    .theme-box{
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-start;
      margin-top: 10px;
      .theme-item{
        width: 200px;
        height: 180px;
        margin-right: 20px;
        cursor: pointer;
        border-radius: 2px;
        .theme-image{
          width: 180px;
          margin: 10px auto;
          img{
            width: 100%;
          }
        }
        .theme-name{
          width: 100%;
          text-align: center;
        }
      }
    }
  }
  .qrcode{
    width: 100%;
    padding-left: 20px;
    margin-top: 20px;
    margin-bottom: 20px;
    .qrcode-box{
      display: flex;
      justify-content: flex-start;
      margin-top: 10px;
      .qrcode-item{
        width: auto;
        height: 300px;
        margin-right: 20px;
        border-radius: 2px;
      }
    }
  }
  .clearDB{
    margin-top: 20px;
    margin-bottom: 20px;
    .clearBtn{
      margin-left: 20px;
      color: red;
      cursor: pointer;
      border: 1px solid #ff000088;
      display: inline-block;
      width: 160px;
      height: 32px;
      font-size: 14px;
      text-align: center;
      line-height: 32px;
    }
    .clearTips{
      margin: 10px 0 0 20px;
      font-size: 12px;
      color: #ff000088;
    }
  }
  .Tips{
    margin: 20px;
    font-size: 12px;
    color: #ff000066;
  }
  .update{
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(7, 17, 27, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    .wrapper{
      background-color: #fff;
      padding: 20px 50px 40px;
      border-radius: 4px;
      max-width: 500px;
      max-height: 90%;
      overflow: auto;
      .footer{
        display: flex;
        justify-content: flex-end;
      }
    }
  }
}
</style>
