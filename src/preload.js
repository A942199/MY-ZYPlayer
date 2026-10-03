'use strict'

const { contextBridge, ipcRenderer } = require('electron')

function invoke (channel, payload) {
  return ipcRenderer.invoke(channel, payload)
}

function send (channel, payload) {
  ipcRenderer.send(channel, payload)
}

function subscribe (channel, listener) {
  if (typeof listener !== 'function') throw new TypeError('listener must be a function')
  const wrapped = (event, payload) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api = Object.freeze({
  window: Object.freeze({
    minimize: () => invoke('app:window:minimize'),
    maximizeToggle: () => invoke('app:window:maximize-toggle'),
    close: () => invoke('app:window:close'),
    setAlwaysOnTop: value => invoke('app:window:set-always-on-top', { value }),
    setBounds: bounds => invoke('app:window:set-bounds', { bounds }),
    getBounds: () => invoke('app:window:get-bounds'),
    getOpacity: () => invoke('app:window:get-opacity'),
    setOpacity: value => invoke('app:window:set-opacity', { value }),
    showEditMenu: () => invoke('app:window:show-edit-menu'),
    onMinimize: listener => subscribe('app:window:minimized', listener),
    onRestore: listener => subscribe('app:window:restored', listener)
  }),
  clipboard: Object.freeze({
    readText: () => invoke('app:clipboard:read-text'),
    writeText: text => invoke('app:clipboard:write-text', { text })
  }),
  shell: Object.freeze({
    openExternal: url => invoke('app:shell:open-external', { url })
  }),
  updater: Object.freeze({
    check: () => send('checkForUpdate'),
    download: () => send('downloadUpdate'),
    install: () => send('quitAndInstall'),
    onAvailable: listener => subscribe('update-available', listener),
    onDownloaded: listener => subscribe('update-downloaded', listener)
  }),
  douban: Object.freeze({
    list: payload => invoke('douban:list', payload),
    search: payload => invoke('douban:search', payload),
    detail: payload => invoke('douban:detail', payload),
    image: payload => invoke('douban:image', payload),
    probe: payload => invoke('douban:probe', payload)
  }),
  network: Object.freeze({
    get: payload => invoke('network:get', payload)
  }),
  sourceRuntime: Object.freeze({
    call: payload => invoke('myvideo:call', payload),
    loadConfig: url => invoke('myvideo:load-config', url),
    clear: () => invoke('myvideo:clear-runtimes')
  }),
  playback: Object.freeze({
    setHeaders: payload => invoke('myvideo:set-playback-headers', payload),
    clearHeaders: payload => invoke('playback:clear-headers', payload),
    prepareProxy: payload => invoke('playback:prepare-proxy', payload),
    releaseProxy: payload => invoke('playback:release-proxy', payload)
  }),
  media: Object.freeze({
    resolveDanmaku: payload => invoke('media-enhancement:danmaku-resolve', payload),
    resolveSubtitles: payload => invoke('media-enhancement:subtitle-resolve', payload),
    fetchSubtitle: payload => invoke('media-enhancement:subtitle-fetch', payload)
  }),
  settings: Object.freeze({
    secretStatus: () => invoke('settings:secret-status'),
    updateSecrets: patch => invoke('settings:update-secrets', { patch }),
    clearSecrets: keys => invoke('settings:clear-secrets', { keys }),
    migrateLegacySecrets: settings => invoke('settings:migrate-legacy-secrets', { settings }),
    applyProxy: proxyRules => invoke('settings:apply-proxy', { proxyRules }),
    getCacheSize: () => invoke('settings:get-cache-size'),
    clearCache: () => invoke('settings:clear-cache')
  })
})

contextBridge.exposeInMainWorld('myzy', api)
