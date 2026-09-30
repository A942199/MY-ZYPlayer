'use strict'

const assert = require('assert')
const Module = require('module')

const expectedDomains = [
  'clipboard',
  'douban',
  'media',
  'playback',
  'settings',
  'shell',
  'sourceRuntime',
  'updater',
  'window'
]

let exposedName = ''
let exposedApi = null
const originalLoad = Module._load

const fakeIpcRenderer = {
  invoke: (channel, payload) => Promise.resolve({ channel, payload }),
  send: () => {},
  on: () => {},
  removeListener: () => {}
}

Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      contextBridge: {
        exposeInMainWorld (name, api) {
          exposedName = name
          exposedApi = api
        }
      },
      ipcRenderer: fakeIpcRenderer
    }
  }
  return originalLoad.call(this, request, parent, isMain)
}

try {
  require('../src/preload')
} finally {
  Module._load = originalLoad
}

assert.strictEqual(exposedName, 'myzy')
assert.deepStrictEqual(Object.keys(exposedApi).sort(), expectedDomains)
assert.strictEqual(Object.prototype.hasOwnProperty.call(exposedApi, 'invoke'), false)

for (const method of ['getOpacity', 'setOpacity', 'onMinimize', 'onRestore', 'showEditMenu']) {
  assert.strictEqual(typeof exposedApi.window[method], 'function', 'missing window.' + method)
}
for (const method of ['applyProxy', 'getCacheSize', 'clearCache']) {
  assert.strictEqual(typeof exposedApi.settings[method], 'function', 'missing settings.' + method)
}

const { getPlatformApi } = require('../src/lib/platform/api')
const previousWindow = global.window

try {
  delete global.window
  assert.throws(() => getPlatformApi(), /bridge/i)
  global.window = { myzy: exposedApi }
  assert.strictEqual(getPlatformApi(), exposedApi)
} finally {
  if (previousWindow === undefined) delete global.window
  else global.window = previousWindow
}

console.log('Preload contract tests passed')
