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
  handle('myvideo:set-playback-headers', plainKeys(['url', 'headers']), 'playback', 'setHeaders')
  handle('playback:clear-headers', payload => payload == null ? {} : plain(payload), 'playback', 'clearHeaders')

  handle('media-enhancement:danmaku-resolve', plain, 'media', 'resolveDanmaku')
  handle('media-enhancement:subtitle-resolve', plain, 'media', 'resolveSubtitles')
  handle('media-enhancement:subtitle-fetch', plain, 'media', 'fetchSubtitle')

  handle('settings:get', null, 'settings', 'get')
  handle('settings:update-patch', plainKeys(['patch']), 'settings', 'updatePatch')
  handle('settings:secret-status', null, 'settings', 'secretStatus')
  handle('settings:update-secrets', plainKeys(['patch']), 'settings', 'updateSecrets')
  handle('settings:clear-secrets', plainKeys(['keys']), 'settings', 'clearSecrets')

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
