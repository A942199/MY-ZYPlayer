'use strict'

const assert = require('assert')
const { registerAppIpc } = require('../src/main/ipc/app-ipc')

function createFakeIpcMain () {
  const handlers = new Map()
  const listeners = new Map()
  return {
    handlers,
    listeners,
    handle (channel, handler) {
      if (handlers.has(channel)) throw new Error('duplicate handler: ' + channel)
      handlers.set(channel, handler)
    },
    removeHandler (channel) {
      handlers.delete(channel)
    },
    on (channel, listener) {
      const list = listeners.get(channel) || []
      list.push(listener)
      listeners.set(channel, list)
    },
    removeListener (channel, listener) {
      const list = listeners.get(channel) || []
      listeners.set(channel, list.filter(item => item !== listener))
    }
  }
}

async function main () {
  const ipcMain = createFakeIpcMain()
  const webContents = {}
  const mainWindow = { webContents }
  const calls = []

  const services = {
    window: {
      minimize: () => calls.push('minimize'),
      maximizeToggle: () => calls.push('maximize'),
      close: () => calls.push('close'),
      setAlwaysOnTop: value => calls.push(['top', value]),
      setBounds: bounds => calls.push(['bounds', bounds]),
      getBounds: () => ({ x: 1, y: 2, width: 3, height: 4 }),
      getOpacity: () => 0.8,
      setOpacity: value => calls.push(['opacity', value]),
      showEditMenu: () => calls.push('edit-menu')
    },
    clipboard: {
      readText: () => 'clip',
      writeText: text => calls.push(['clip', text])
    },
    shell: {
      openExternal: url => {
        calls.push(['open', url])
        return true
      }
    },
    updater: {
      check: () => calls.push('update-check'),
      download: () => calls.push('update-download'),
      install: () => calls.push('update-install')
    },
    douban: {
      list: payload => ({ ok: true, payload }),
      search: payload => payload,
      detail: payload => payload,
      image: payload => payload,
      probe: payload => payload
    },
    network: {
      get: payload => ({ ok: true, payload })
    },
    sourceRuntime: {
      call: payload => ({ ok: true, payload }),
      loadConfig: url => ({ url }),
      clear: () => true
    },
    playback: {
      setHeaders: payload => payload,
      clearHeaders: payload => payload
    },
    media: {
      resolveDanmaku: payload => payload,
      resolveSubtitles: payload => payload,
      fetchSubtitle: payload => payload
    },
    settings: {
      get: () => ({}),
      updatePatch: payload => payload,
      secretStatus: () => ({ configured: {} }),
      updateSecrets: payload => payload,
      clearSecrets: payload => payload,
      applyProxy: payload => calls.push(['proxy', payload]),
      getCacheSize: () => 4096,
      clearCache: () => calls.push('clear-cache')
    }
  }

  const cleanup = registerAppIpc({
    ipcMain,
    getMainWindow: () => mainWindow,
    services
  })

  const event = { sender: webContents }
  const listResult = await ipcMain.handlers.get('douban:list')(event, { kind: 'movie' })
  assert.deepStrictEqual(listResult, { ok: true, payload: { kind: 'movie' } })
  const networkResult = await ipcMain.handlers.get('network:get')(event, { url: 'https://example.com/api', timeout: 3000 })
  assert.deepStrictEqual(networkResult, { ok: true, payload: { url: 'https://example.com/api', timeout: 3000, maxBytes: undefined } })
  await assert.rejects(
    () => ipcMain.handlers.get('network:get')(event, { url: 'file:///tmp/a' }),
    /http/i
  )

  await assert.rejects(
    () => ipcMain.handlers.get('douban:list')({ sender: {} }, { kind: 'movie' }),
    /sender/i
  )

  await assert.rejects(
    () => ipcMain.handlers.get('myvideo:call')(event, {
      source: { key: 'x', ext: 'https://example.com/source.js' },
      method: 'require',
      args: {}
    }),
    /method|unsupported/i
  )

  await assert.rejects(
    () => ipcMain.handlers.get('app:shell:open-external')(event, { url: 'file:///etc/passwd' }),
    /http/i
  )
  assert.strictEqual(calls.some(item => Array.isArray(item) && item[0] === 'open'), false)

  assert.strictEqual(await ipcMain.handlers.get('app:window:get-opacity')(event), 0.8)
  await ipcMain.handlers.get('app:window:set-opacity')(event, { value: 0.7 })
  await ipcMain.handlers.get('app:window:show-edit-menu')(event)
  await ipcMain.handlers.get('settings:apply-proxy')(event, { proxyRules: 'direct://' })
  assert.strictEqual(await ipcMain.handlers.get('settings:get-cache-size')(event), 4096)
  await ipcMain.handlers.get('settings:clear-cache')(event)
  assert.deepStrictEqual(calls.slice(-4), [
    ['opacity', 0.7],
    'edit-menu',
    ['proxy', 'direct://'],
    'clear-cache'
  ])

  assert.strictEqual(ipcMain.listeners.get('checkForUpdate').length, 1)
  cleanup()
  assert.strictEqual(ipcMain.listeners.get('checkForUpdate').length, 0)
  assert.strictEqual(ipcMain.handlers.size, 0)

  console.log('Validated app IPC contract tests passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
