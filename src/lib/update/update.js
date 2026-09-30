import { BrowserWindow } from 'electron'
const { autoUpdater } = require('electron-updater')

export function createUpdaterService (updater = autoUpdater) {
  return {
    check: () => updater.checkForUpdates(),
    download: () => updater.downloadUpdate(),
    install: () => updater.quitAndInstall()
  }
}

export const updaterService = createUpdaterService(autoUpdater)

// electron-updater 增量更新时似乎无法显示进度
export function initUpdater (win = BrowserWindow, updater = autoUpdater) {
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = true

  const listeners = []
  const on = (event, listener) => {
    updater.on(event, listener)
    listeners.push([event, listener])
  }
  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  on('checking-for-update', () => send('checking-for-update'))
  on('update-available', info => send('update-available', info))
  on('update-not-available', () => send('update-not-available'))
  on('update-error', err => send('update-error', err))
  on('download-progress', progressObj => send('download-progress', progressObj))
  on('update-downloaded', () => send('update-downloaded'))

  return () => {
    listeners.forEach(([event, listener]) => updater.removeListener(event, listener))
  }
}

