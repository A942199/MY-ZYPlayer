'use strict'

import { app, protocol, BrowserWindow, globalShortcut, ipcMain, shell, clipboard, Menu, safeStorage } from 'electron'
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import { initUpdater, updaterService } from './lib/update/update'
const { applyPlaybackHeaders, applyPlaybackResponseHeaders, callMyVideo, loadMyVideoConfig, clearMyVideoRuntimes, setPlaybackHeaders, clearPlaybackHeaderScope } = require('./main/myvideo/runtime')
const { listSubjects, searchSubjects, subjectDetail, fetchImageData, probeUrl } = require('./main/douban/runtime')
const { resolveDanmakuWithSecrets, resolveSubtitlesWithSecrets, fetchSubtitle, initializeMediaEnhancementRuntime, setMediaSecretResolver } = require('./main/media-enhancement/runtime')
const { startLocalDanmuApi, stopLocalDanmuApi } = require('./main/media-enhancement/local-danmu-runtime')
const path = require('path')
const fs = require('fs')
const { createMainWindowWebPreferences } = require('./main/security/window-policy')
const { registerAppIpc } = require('./main/ipc/app-ipc')
const { siteNetworkService } = require('./main/network/runtime')
const { createSettingsSecretRuntime } = require('./main/settings/runtime')

const isDevelopment = process.env.NODE_ENV !== 'production'
let settingsSecretRuntime = null

function requireSettingsSecretRuntime () {
  if (!settingsSecretRuntime) throw new Error('Settings secret runtime is unavailable')
  return settingsSecretRuntime
}

setMediaSecretResolver(async () => {
  try {
    return await requireSettingsSecretRuntime().readForMainProcess()
  } catch (error) {
    return {}
  }
})

initializeMediaEnhancementRuntime()

function requireMainWindow () {
  if (!win || win.isDestroyed()) throw new Error('Main window is unavailable')
  return win
}

registerAppIpc({
  ipcMain,
  getMainWindow: () => win,
  services: {
    window: {
      minimize: () => requireMainWindow().minimize(),
      maximizeToggle: () => {
        const current = requireMainWindow()
        if (current.isMaximized()) current.unmaximize()
        else current.maximize()
        return current.getBounds()
      },
      close: () => requireMainWindow().destroy(),
      setAlwaysOnTop: value => requireMainWindow().setAlwaysOnTop(value),
      setBounds: bounds => requireMainWindow().setBounds(bounds),
      getBounds: () => requireMainWindow().getBounds(),
      getOpacity: () => requireMainWindow().getOpacity(),
      setOpacity: value => requireMainWindow().setOpacity(value),
      showEditMenu: () => {
        const menu = Menu.buildFromTemplate([
          { label: '快速复制', role: 'copy' },
          { label: '快速粘贴', role: 'paste' },
          { label: '编辑', role: 'editMenu' }
        ])
        menu.popup({ window: requireMainWindow() })
        return true
      }
    },
    clipboard: {
      readText: () => clipboard.readText(),
      writeText: text => clipboard.writeText(text)
    },
    shell: {
      openExternal: url => shell.openExternal(url)
    },
    updater: updaterService,
    douban: {
      list: listSubjects,
      search: searchSubjects,
      detail: subjectDetail,
      image: fetchImageData,
      probe: probeUrl
    },
    network: siteNetworkService,
    sourceRuntime: {
      call: callMyVideo,
      loadConfig: loadMyVideoConfig,
      clear: clearMyVideoRuntimes
    },
    playback: {
      setHeaders: setPlaybackHeaders,
      clearHeaders: clearPlaybackHeaderScope
    },
    media: {
      resolveDanmaku: resolveDanmakuWithSecrets,
      resolveSubtitles: resolveSubtitlesWithSecrets,
      fetchSubtitle
    },
    settings: {
      secretStatus: () => requireSettingsSecretRuntime().secretStatus(),
      updateSecrets: patch => requireSettingsSecretRuntime().updateSecrets(patch),
      clearSecrets: keys => requireSettingsSecretRuntime().clearSecrets(keys),
      migrateLegacy: settings => requireSettingsSecretRuntime().migrateLegacy(settings),
      applyProxy: proxyRules => requireMainWindow().webContents.session.setProxy({ proxyRules }),
      getCacheSize: () => requireMainWindow().webContents.session.getCacheSize(),
      clearCache: () => requireMainWindow().webContents.session.clearCache()
    }
  }
})

// const log = require('electron-log') // 用于调试主程序

let win

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }])

function createAppProtocol () {
  protocol.registerFileProtocol('app', (request, callback) => {
    try {
      const url = new URL(request.url)
      let relativePath = decodeURI(url.pathname || '/')
      if (url.hostname && url.hostname !== '.') {
        relativePath = '/' + url.hostname + (relativePath === '/' ? '' : relativePath)
      }
      relativePath = relativePath.replace(/^[/\\]+/, '')
      const root = path.resolve(__dirname)
      const filePath = path.resolve(root, relativePath)
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        callback({ error: -6 })
        return
      }
      callback({ path: filePath })
    } catch (error) {
      console.error('[app protocol] failed:', request.url, error)
      callback({ error: -6 })
    }
  })
}

function createWindow () {
  win = new BrowserWindow({
    width: 1080,
    height: 720,
    frame: false,
    resizable: true,
    webPreferences: createMainWindowWebPreferences(path.join(__dirname, 'preload.js'))
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    win.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) win.webContents.openDevTools()
  } else {
    createAppProtocol()
    win.loadURL('app://./index.html')
  }
  
  // 修改request headers
  // Sec-Fetch下禁止修改，浏览器自动加上请求头 https://www.cnblogs.com/fulu/p/13879080.html 暂时先用index.html的meta referer policy替代
  const filter = {
    urls: ['http://*/*', 'https://*/*']
  }
  // Keep remote content from replacing the privileged application document.
  win.webContents.on('will-navigate', (event, targetUrl) => {
    let allowed = false
    try {
      if (process.env.WEBPACK_DEV_SERVER_URL) {
        allowed = new URL(targetUrl).origin === new URL(process.env.WEBPACK_DEV_SERVER_URL).origin
      } else {
        allowed = targetUrl.startsWith('app://')
      }
    } catch (error) {}
    if (!allowed) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({
      cancel: false,
      requestHeaders: applyPlaybackHeaders(details.url, details.requestHeaders)
    })
  })
  win.webContents.session.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({
      cancel: false,
      responseHeaders: applyPlaybackResponseHeaders(details.url, details.responseHeaders)
    })
  })

  win.on('minimize', () => {
    if (win && !win.isDestroyed()) win.webContents.send('app:window:minimized')
  })
  win.on('restore', () => {
    if (win && !win.isDestroyed()) win.webContents.send('app:window:restored')
  })

  initUpdater(win)

  win.on('closed', () => {
    win = null
  })
}

if (process.platform === 'darwin') {
  app.dock.show()
}
if (process.platform === 'linux') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('--no-sandbox') // linux 关闭沙盒模式
}
app.allowRendererProcessReuse = true

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  stopLocalDanmuApi()
})

app.on('activate', () => {
  if (win === null) {
    createWindow()
  }
})

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.on('ready', async () => {
    if (isDevelopment && !process.env.IS_TEST) {
      try {
        await installExtension(VUEJS_DEVTOOLS)
      } catch (e) {
        console.error('Vue Devtools failed to install:', e.toString())
      }
    }
    settingsSecretRuntime = createSettingsSecretRuntime({
      safeStorage,
      fs,
      userDataPath: app.getPath('userData')
    })
    createWindow()
    startLocalDanmuApi().catch(error => {
      console.error('[danmu_api] local runtime warmup failed:', error && error.message ? error.message : error)
    })
    globalShortcut.register('Alt+Space', () => {
      if (win) {
        win.isFocused() ? win.blur() : win.focus()
      }
    })
  })
}

if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', data => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}
