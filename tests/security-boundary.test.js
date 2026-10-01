'use strict'

const assert = require('assert')
const {
  MAIN_WINDOW_SECURITY_INVARIANTS,
  createMainWindowWebPreferences
} = require('../src/main/security/window-policy')

const preload = 'C:\\preload.js'
const prefs = createMainWindowWebPreferences(preload)

assert.strictEqual(prefs.preload, preload)
assert.strictEqual(prefs.nodeIntegration, false)
assert.strictEqual(prefs.contextIsolation, true)
assert.strictEqual(prefs.enableRemoteModule, false)
assert.strictEqual(prefs.webviewTag, false)
assert.strictEqual(prefs.allowRunningInsecureContent, false)
assert.strictEqual(prefs.webSecurity, true)

assert.deepStrictEqual(MAIN_WINDOW_SECURITY_INVARIANTS, {
  nodeIntegration: false,
  contextIsolation: true,
  enableRemoteModule: false,
  webviewTag: false,
  allowRunningInsecureContent: false,
  webSecurity: true
})

const fs = require('fs')
const path = require('path')
const background = fs.readFileSync(path.resolve(__dirname, '../src/background.js'), 'utf8')
const packageJson = require('../package.json')

assert.strictEqual(background.includes('OutOfBlinkCors'), false)
assert.strictEqual(background.includes('webSecurity: false'), false)
assert.strictEqual(Boolean(packageJson.dependencies && packageJson.dependencies['@electron/remote']), false)

console.log('Electron security boundary policy tests passed')
