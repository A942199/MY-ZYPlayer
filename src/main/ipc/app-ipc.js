'use strict'

const {
  assertAllowedKeys,
  assertAppSender,
  assertHttpUrl,
  assertPlainObject
} = require('./guards')

const MYVIDEO_METHODS = new Set([
  'getConfig',
  'getCards',
  'getTracks',
  'getPlayinfo',
  'search',
  'getLocalInfo'
])

function requireServiceMethod (services, domain, method) {
  const service = services && services[domain]
  const fn = service && service[method]
  if (typeof fn !== 'function') throw new Error('IPC service unavailable: ' + domain + '.' + method)
  return fn
}

function registerAppIpc ({ ipcMain, getMainWindow, services = {} }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required')
  if (typeof getMainWindow !== 'function') throw new TypeError('getMainWindow is required')

  const handledChannels = []
  const eventListeners = []

  const guardSender = event => assertAppSender(event, getMainWindow())

  const handle = (channel, validator, domain, method) => {
    ipcMain.handle(channel, async (event, payload) => {
      guardSender(event)
      const value = validator ? validator(payload) : payload
      return await requireServiceMethod(services, domain, method)(value)
    })
    handledChannels.push(channel)
  }

  const on = (channel, domain, method) => {
    const listener = event => {
      guardSender(event)
      return requireServiceMethod(services, domain, method)()
    }
    ipcMain.on(channel, listener)
    eventListeners.push([channel, listener])
  }

  const plain = payload => assertPlainObject(payload)
  const plainKeys = keys => payload => {
    assertAllowedKeys(payload, keys)
    return payload
  }

  handle('app:window:minimize', null, 'window', 'minimize')
  handle('app:window:maximize-toggle', null, 'window', 'maximizeToggle')
  handle('app:window:close', null, 'window', 'close')
  handle('app:window:set-always-on-top', payload => {
    assertAllowedKeys(payload, ['value'])
    if (typeof payload.value !== 'boolean') throw new TypeError('value must be boolean')
    return payload.value
  }, 'window', 'setAlwaysOnTop')
  handle('app:window:set-bounds', payload => {
    assertAllowedKeys(payload, ['bounds'])
    assertPlainObject(payload.bounds, 'bounds')
    return payload.bounds
  }, 'window', 'setBounds')
  handle('app:window:get-bounds', null, 'window', 'getBounds')
  handle('app:window:get-opacity', null, 'window', 'getOpacity')
  handle('app:window:set-opacity', payload => {
    assertAllowedKeys(payload, ['value'])
    if (typeof payload.value !== 'number' || !Number.isFinite(payload.value) || payload.value < 0.1 || payload.value > 1) {
      throw new TypeError('value must be a number between 0.1 and 1')
    }
    return payload.value
  }, 'window', 'setOpacity')
  handle('app:window:show-edit-menu', null, 'window', 'showEditMenu')

  handle('app:clipboard:read-text', null, 'clipboard', 'readText')
  handle('app:clipboard:write-text', payload => {
    assertAllowedKeys(payload, ['text'])
    if (typeof payload.text !== 'string') throw new TypeError('text must be a string')
    if (Buffer.byteLength(payload.text, 'utf8') > 1024 * 1024) throw new RangeError('text is too large')
    return payload.text
  }, 'clipboard', 'writeText')

  handle('app:shell:open-external', payload => {
    assertAllowedKeys(payload, ['url'])
    return assertHttpUrl(payload.url, 'url').toString()
  }, 'shell', 'openExternal')

  on('checkForUpdate', 'updater', 'check')
  on('downloadUpdate', 'updater', 'download')
  on('quitAndInstall', 'updater', 'install')

  handle('douban:list', plain, 'douban', 'list')
  handle('douban:search', plain, 'douban', 'search')
  handle('douban:detail', plain, 'douban', 'detail')
  handle('douban:image', plain, 'douban', 'image')
  handle('douban:probe', plain, 'douban', 'probe')

  handle('network:get', payload => {
    assertAllowedKeys(payload, ['url', 'timeout', 'maxBytes'])
    const url = assertHttpUrl(payload.url, 'url').toString()
    const timeout = payload.timeout === undefined ? undefined : Number(payload.timeout)
    const maxBytes = payload.maxBytes === undefined ? undefined : Number(payload.maxBytes)
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 1000 || timeout > 60000)) throw new TypeError('timeout out of range')
    if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024)) throw new TypeError('maxBytes out of range')
    return { url, timeout, maxBytes }
  }, 'network', 'get')

  handle('myvideo:call', payload => {
    assertAllowedKeys(payload, ['source', 'method', 'args'])
    assertPlainObject(payload.source, 'source')
    if (typeof payload.method !== 'string' || !MYVIDEO_METHODS.has(payload.method)) {
      throw new TypeError('Unsupported MyVideo method')
    }
    return payload
  }, 'sourceRuntime', 'call')
  handle('myvideo:load-config', url => assertHttpUrl(url, 'url').toString(), 'sourceRuntime', 'loadConfig')
  handle('myvideo:clear-runtimes', null, 'sourceRuntime', 'clear')
  handle('myvideo:set-playback-headers', plainKeys(['url', 'headers', 'pathPrefix']), 'playback', 'setHeaders')
  handle('playback:clear-headers', plainKeys(['scopeId']), 'playback', 'clearHeaders')

  handle('media-enhancement:danmaku-resolve', plain, 'media', 'resolveDanmaku')
  handle('media-enhancement:subtitle-resolve', plain, 'media', 'resolveSubtitles')
  handle('media-enhancement:subtitle-fetch', plain, 'media', 'fetchSubtitle')

  handle('settings:secret-status', null, 'settings', 'secretStatus')
  handle('settings:update-secrets', payload => {
    assertAllowedKeys(payload, ['patch'])
    return assertPlainObject(payload.patch, 'patch')
  }, 'settings', 'updateSecrets')
  handle('settings:clear-secrets', payload => {
    assertAllowedKeys(payload, ['keys'])
    if (!Array.isArray(payload.keys)) throw new TypeError('keys must be an array')
    return payload.keys
  }, 'settings', 'clearSecrets')
  handle('settings:migrate-legacy-secrets', payload => {
    assertAllowedKeys(payload, ['settings'])
    return assertPlainObject(payload.settings, 'settings', 256 * 1024)
  }, 'settings', 'migrateLegacy')
  handle('settings:apply-proxy', payload => {
    assertAllowedKeys(payload, ['proxyRules'])
    if (typeof payload.proxyRules !== 'string' || payload.proxyRules.length > 2048) throw new TypeError('proxyRules must be a string')
    return payload.proxyRules
  }, 'settings', 'applyProxy')
  handle('settings:get-cache-size', null, 'settings', 'getCacheSize')
  handle('settings:clear-cache', null, 'settings', 'clearCache')

  return () => {
    handledChannels.forEach(channel => {
      if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(channel)
    })
    eventListeners.forEach(([channel, listener]) => ipcMain.removeListener(channel, listener))
  }
}

module.exports = {
  MYVIDEO_METHODS,
  registerAppIpc
}
