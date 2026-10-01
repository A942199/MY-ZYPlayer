<template>
  <div id="app" :class="appTheme">
    <Aside />
    <div class="zy-body">
      <Frame />
      <Film v-show="view === 'Film'" />
      <Douban v-show="view === 'Douban'" />
      <Play v-show="view === 'Play'" />
      <Star v-show="view === 'Star'" />
      <History v-show="view === 'History'" />
      <Setting v-show="view === 'Setting'" />
      <EditSites v-if="view === 'EditSites'"/>
    </div>
    <transition name="slide">
      <Detail v-if="detail.show"/>
    </transition>
  </div>
</template>

<script>
import { setting, settingsRepository } from './lib/dexie'
const { getPlatformApi } = require('./lib/platform/api')
export default {
  name: 'App',
  data () {
    return {
      appTheme: 'theme-light',
      winSizePosition: {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      }
    }
  },
  created () {
    // 窗口创建口，检查是否有窗口大小位置的记录，如果有的话，更新窗口位置及大小
    setting.find().then(async res => {
      if (res.restoreWindowPositionAndSize) {
        const platform = getPlatformApi()
        await platform.window.setBounds({
          x: res.windowPositionAndSize.x,
          y: res.windowPositionAndSize.y,
          width: res.windowPositionAndSize.width,
          height: res.windowPositionAndSize.height
        })
        this.winSizePosition = await platform.window.getBounds()
      }
    })
  },
  async updated () {
    // 本来想hook up到beforedestroy， 但不工作
    // 每当窗口更新时，检查窗口大小及位置，记录到setting数据库中
    if (this.setting.restoreWindowPositionAndSize) {
      const newWinSizePosition = await getPlatformApi().window.getBounds()
      if (newWinSizePosition.x !== this.winSizePosition.x ||
        newWinSizePosition.y !== this.winSizePosition.y ||
        newWinSizePosition.width !== this.winSizePosition.width ||
        newWinSizePosition.height !== this.winSizePosition.height) {
        this.winSizePosition = newWinSizePosition
        settingsRepository.updatePatch({ windowPositionAndSize: newWinSizePosition })
      }
    }
  },
  computed: {
    view () {
      return this.$store.getters.getView
    },
    detail () {
      return this.$store.getters.getDetail
    },
    setting () {
      return this.$store.getters.getSetting
    }
  },
  watch: {
    setting: {
      handler () {
        this.changeSetting()
      },
      deep: true
    }
  },
  methods: {
    changeSetting () {
      this.appTheme = `theme-${this.setting.theme}`
    }
  }
}
</script>

<style lang="scss">
@import './assets/scss/theme.scss';
html, body, #app{
  height: 100%;
  border-radius: 0px;
}
#app {
  font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', SimSun, sans-serif;
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  .zy-body{
    flex: 1;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    flex-direction: column;
    padding: 0 20px 20px;
  }
}
</style>
