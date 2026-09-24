'use strict'

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const exe = process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '..', 'dist_electron', 'win-unpacked', 'MY-ZYPlayer.exe')
const port = 9237
const profile = path.join(os.tmpdir(), 'my-zyplayer-nav-audit-' + process.pid)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function getJson (url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let data = ''
      response.on('data', chunk => { data += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
      })
    }).on('error', reject)
  })
}

async function waitForPage () {
  let lastError
  for (let i = 0; i < 80; i++) {
    try {
      const pages = await getJson('http://127.0.0.1:' + port + '/json')
      if (pages.length) return pages[0]
    } catch (error) {
      lastError = error
    }
    await sleep(250)
  }
  throw lastError || new Error('CDP did not become ready')
}

async function connectCdp (url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let id = 0
  socket.on('message', buffer => {
    const message = JSON.parse(buffer)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  await new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return {
    socket,
    send (method, params = {}) {
      return new Promise(resolve => {
        const messageId = ++id
        pending.set(messageId, resolve)
        socket.send(JSON.stringify({ id: messageId, method, params }))
      })
    }
  }
}

async function main () {
  if (process.platform !== 'win32') {
    console.log('Navigation E2E skipped: Windows only')
    return
  }
  assert(fs.existsSync(exe), 'Build Windows app first: ' + exe)
  fs.rmSync(profile, { recursive: true, force: true })
  const child = spawn(exe, ['--remote-debugging-port=' + port, '--user-data-dir=' + profile], {
    cwd: path.dirname(exe),
    stdio: 'ignore'
  })
  let cdp
  try {
    const page = await waitForPage()
    cdp = await connectCdp(page.webSocketDebuggerUrl)
    async function evaluate (expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.result && result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails))
      return result.result && result.result.result && result.result.result.value
    }
    for (let i = 0; i < 100; i++) {
      if (await evaluate("!!(document.querySelector('#app') && document.querySelector('#app').__vue__)")) break
      await sleep(100)
    }

    const cases = [
      ['Film', '#film'],
      ['Douban', '.douban-page'],
      ['Play', '.play'],
      ['Star', '#star'],
      ['History', '#history'],
      ['EditSites', '#sites'],
      ['Setting', '.setting']
    ]

    const count = await evaluate("document.querySelectorAll('.aside > span').length")
    assert.strictEqual(count, cases.length, 'Unexpected navigation item count')

    for (let i = 0; i < cases.length; i++) {
      const [view, selector] = cases[i]
      const result = await evaluate(
        "(async()=>{const nodes=Array.from(document.querySelectorAll('.aside > span'));nodes[" + i + "].click();" +
        "await new Promise(r=>setTimeout(r,180));const app=document.querySelector('#app').__vue__;" +
        "const el=document.querySelector(" + JSON.stringify(selector) + ");" +
        "return {view:app.$store.getters.getView,visible:!!(el&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0)," +
        "active:nodes[" + i + "].classList.contains('active')};})()"
      )
      assert.strictEqual(result.view, view, 'Store view mismatch for ' + view)
      assert.strictEqual(result.visible, true, 'View not visible for ' + view)
      assert.strictEqual(result.active, true, 'Active nav state missing for ' + view)
    }

    const titleCount = await evaluate("Array.from(document.querySelectorAll('.aside svg title')).filter(n=>n.textContent.trim()).length")
    assert.strictEqual(titleCount, cases.length, 'Every navigation icon should expose a title')
    console.log(JSON.stringify({ navigation: 'passed', items: cases.map(x => x[0]) }))
  } finally {
    if (cdp && cdp.socket) cdp.socket.close()
    child.kill()
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
