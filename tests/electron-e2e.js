'use strict'

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const exe = path.resolve(__dirname, '..', 'dist_electron', 'win-unpacked', 'MY-ZYPlayer.exe')
const port = 9231
const profile = path.join(os.tmpdir(), 'my-zyplayer-e2e-' + process.pid)

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getJson (url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      let data = ''
      response.on('data', chunk => { data += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (error) {
          reject(error)
        }
      })
    }).on('error', reject)
  })
}

async function waitForPages () {
  let lastError
  for (let index = 0; index < 60; index++) {
    try {
      const pages = await getJson('http://127.0.0.1:' + port + '/json')
      if (pages.length) return pages
    } catch (error) {
      lastError = error
    }
    await sleep(500)
  }
  throw lastError || new Error('CDP did not become ready')
}

async function connectCdp (webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
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
    console.log('Electron E2E skipped: Windows only')
    return
  }
  assert(fs.existsSync(exe), 'Build Windows app first: ' + exe)
  fs.rmSync(profile, { recursive: true, force: true })

  const child = spawn(exe, [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile
  ], {
    cwd: path.dirname(exe),
    stdio: 'ignore'
  })

  let cdp
  try {
    const pages = await waitForPages()
    cdp = await connectCdp(pages[0].webSocketDebuggerUrl)

    async function evaluate (expression) {
      const message = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      })
      if (message.result && message.result.exceptionDetails) {
        throw new Error(JSON.stringify(message.result.exceptionDetails))
      }
      return message.result && message.result.result && message.result.result.value
    }

    const stateExpression = `(() => {
      const root = document.querySelector('#app').__vue__
      const app = root.$children[0]
      const film = app.$children.find(component => String(component.$options.name).toLowerCase() === 'film')
      return JSON.stringify({
        site: film.site && { key: film.site.key, name: film.site.name },
        selectedSiteName: film.selectedSiteName,
        classListLen: film.classList.length,
        listLen: film.list.length,
        filteredLen: film.filteredList.length,
        cards: document.querySelectorAll('#film .card').length,
        firstCard: document.querySelector('#film .card .name') && document.querySelector('#film .card .name').innerText,
        statusText: film.statusText
      })
    })()`

    let defaultState
    for (let index = 0; index < 60; index++) {
      defaultState = JSON.parse(await evaluate(stateExpression))
      if (defaultState.filteredLen > 0 && defaultState.cards > 0) break
      await sleep(500)
    }
    assert(defaultState.filteredLen > 0, 'Fresh profile did not render any default-source cards')
    assert(defaultState.cards > 0, 'Fresh profile DOM did not render any cards')

    await evaluate(`(() => {
      const app = document.querySelector('#app').__vue__.$children[0]
      const film = app.$children.find(component => String(component.$options.name).toLowerCase() === 'film')
      film.selectedSiteName = '星芽短劇'
      film.siteClick('星芽短劇')
      return true
    })()`)

    let xingyaState
    for (let index = 0; index < 60; index++) {
      xingyaState = JSON.parse(await evaluate(stateExpression))
      if (xingyaState.site && xingyaState.site.key === 'csp_xingya' && xingyaState.cards > 0) break
      await sleep(500)
    }
    assert.strictEqual(xingyaState.site.key, 'csp_xingya')
    assert(xingyaState.filteredLen > 0, 'Xingya data was filtered out')
    assert(xingyaState.cards > 0, 'Xingya cards were not rendered')

    const criticalSources = [
      '[兔]123TV🎬',
      '[兔]飞快TV🎬',
      '[兔]2k动漫(无搜索)🌸',
      '[兔]月之祠🌸',
      '[兔]11KT🌸'
    ]
    const criticalSourceCards = {}
    for (const sourceName of criticalSources) {
      await evaluate(`(() => {
        const app = document.querySelector('#app').__vue__.$children[0]
        const film = app.$children.find(component => String(component.$options.name).toLowerCase() === 'film')
        film.selectedSiteName = ${JSON.stringify(sourceName)}
        film.siteClick(${JSON.stringify(sourceName)})
        return true
      })()`)
      let sourceState
      for (let index = 0; index < 60; index++) {
        sourceState = JSON.parse(await evaluate(stateExpression))
        if (sourceState.site && sourceState.site.name === sourceName && sourceState.cards > 0) break
        await sleep(500)
      }
      assert.strictEqual(sourceState.site.name, sourceName)
      assert(sourceState.filteredLen > 0, sourceName + ' data was filtered out')
      assert(sourceState.cards > 0, sourceName + ' cards were not rendered')
      criticalSourceCards[sourceName] = sourceState.cards
    }

    await evaluate(`(() => {
      const app = document.querySelector('#app').__vue__.$children[0]
      const film = app.$children.find(component => String(component.$options.name).toLowerCase() === 'film')
      film.selectedSiteName = '星芽短劇'
      film.siteClick('星芽短劇')
      return true
    })()`)
    for (let index = 0; index < 60; index++) {
      xingyaState = JSON.parse(await evaluate(stateExpression))
      if (xingyaState.site && xingyaState.site.key === 'csp_xingya' && xingyaState.cards > 0) break
      await sleep(500)
    }

    const clicked = await evaluate(`(() => {
      const element = document.querySelector('#film .card .name')
      if (!element) return false
      element.click()
      return true
    })()`)
    assert.strictEqual(clicked, true)
    await sleep(1500)
    const detail = JSON.parse(await evaluate(`(() => {
      const app = document.querySelector('#app').__vue__.$children[0]
      return JSON.stringify({
        show: app.$store.state.detail.show,
        key: app.$store.state.detail.key,
        visible: !!document.querySelector('.detail')
      })
    })()`))
    assert.strictEqual(detail.show, true)
    assert.strictEqual(detail.key, 'csp_xingya')
    assert.strictEqual(detail.visible, true)

    console.log(JSON.stringify({
      defaultSource: defaultState.site,
      defaultCards: defaultState.cards,
      xingyaCards: xingyaState.cards,
      xingyaFirstCard: xingyaState.firstCard,
      criticalSourceCards,
      detailOpened: detail.visible
    }, null, 2))
  } finally {
    if (cdp) cdp.socket.close()
    child.kill()
    await sleep(500)
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
