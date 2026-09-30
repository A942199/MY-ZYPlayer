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
      getBounds: () => ({ x: 1, y: 2, width: 3, height: 4 })
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
      clearSecrets: payload => payload
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
