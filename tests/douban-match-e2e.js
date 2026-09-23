'use strict'

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const exe = path.resolve(__dirname, '..', 'dist_electron', 'win-unpacked', 'MY-ZYPlayer.exe')
const cdpPort = 9242
const profile = path.join(os.tmpdir(), 'my-zyplayer-douban-match-' + process.pid)
const subjectYears = new Map()
let cmsHitTitle = ''

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function json (res, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length
  })
  res.end(body)
}

function startMockServer () {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const origin = 'http://127.0.0.1:' + server.address().port
      const target = new URL(req.url, origin)

      if (target.pathname === '/media.mp4') {
        const body = Buffer.from('my-zyplayer-local-video-probe')
        res.writeHead(req.headers.range ? 206 : 200, {
          'Content-Type': 'video/mp4',
          'Content-Length': body.length,
          'Accept-Ranges': 'bytes'
        })
        res.end(body)
        return
      }

      if (target.pathname === '/cms') {
        if (target.searchParams.get('ids') === 'cms1') {
          json(res, {
            code: 1,
            page: 1,
            pagecount: 1,
            limit: 1,
            total: 1,
            list: [{
              vod_id: 'cms1',
              vod_name: cmsHitTitle,
              vod_year: subjectYears.get(cmsHitTitle) || '',
              vod_play_from: 'local',
              vod_play_url: '正片$' + origin + '/media.mp4'
            }]
          })
          return
        }

        const text = target.searchParams.get('wd') || ''
        const hit = text === cmsHitTitle
        json(res, {
          code: 1,
          page: 1,
          pagecount: 1,
          limit: 20,
          total: hit ? 1 : 0,
          list: hit
            ? [{
                vod_id: 'cms1',
                vod_name: cmsHitTitle,
                vod_year: subjectYears.get(cmsHitTitle) || ''
              }]
            : []
        })
        return
      }

      if (target.pathname === '/mock-fast.js' || target.pathname === '/mock-slow.js') {
        const years = JSON.stringify(Object.fromEntries(subjectYears))
        const delay = target.pathname === '/mock-slow.js' ? 1400 : 0
        const code = [
          'const BASE = ' + JSON.stringify(origin),
          'const YEARS = ' + years,
          'const DELAY = ' + delay,
          'async function getConfig(){ return jsonify({tabs:[{name:"首页",ext:{}}]}) }',
          'async function getCards(){ return jsonify({list:[],page:1,over:1}) }',
          'async function search(p){ p=argsify(p)||{}; const text=String(p.text||""); return jsonify({list:[{vod_id:"bd1",vod_name:text,vod_year:YEARS[text]||"",ext:{id:"bd1",title:text}}],page:1}) }',
          'async function getTracks(p){ p=argsify(p)||{}; if(DELAY) await new Promise(resolve=>setTimeout(resolve,DELAY)); const title=String(p.title||(p.ext&&p.ext.title)||""); return jsonify({detail:{vod_name:title,vod_year:YEARS[title]||"",kind:"movie"},list:[{title:"本地BD",tracks:[{name:"正片",ext:{url:BASE+"/media.mp4"}}]}]}) }',
          'async function getPlayinfo(p){ p=argsify(p)||{}; return jsonify({urls:[String(p.url||(p.ext&&p.ext.url)||BASE+"/media.mp4")]}) }'
        ].join('\n')
        const body = Buffer.from(code)
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': body.length
        })
        res.end(body)
        return
      }

      res.writeHead(404)
      res.end()
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

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

async function waitForPages () {
  for (let index = 0; index < 80; index++) {
    try {
      const pages = await getJson('http://127.0.0.1:' + cdpPort + '/json')
      if (pages.length) return pages
    } catch (error) {}
    await sleep(250)
  }
  throw new Error('CDP did not become ready')
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
    console.log('Douban match E2E skipped: Windows only')
    return
  }
  assert(fs.existsSync(exe), 'Build Windows app first: ' + exe)

  const server = await startMockServer()
  const base = 'http://127.0.0.1:' + server.address().port
  fs.rmSync(profile, { recursive: true, force: true })

  const child = spawn(exe, [
    '--remote-debugging-port=' + cdpPort,
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

    for (let index = 0; index < 80; index++) {
      const ready = await evaluate("!!(document.querySelector('#app') && document.querySelector('#app').__vue__)")
      if (ready) break
      await sleep(250)
    }
    await sleep(4000)

    const subjects = JSON.parse(await evaluate(`(async () => {
      const ipc = require('electron').ipcRenderer
      const list = await ipc.invoke('douban:list', { kind: 'movie', tag: '热门', limit: 4 })
      const out = []
      for (const item of (list.list || []).slice(0, 4)) {
        try {
          const detail = await ipc.invoke('douban:detail', item)
          if (detail && detail.title && detail.year && detail.kind === 'movie') out.push({ item, detail })
        } catch (error) {}
        if (out.length >= 2) break
      }
      return JSON.stringify(out)
    })()`))
    assert(subjects.length >= 2, 'Need two Douban movie subjects for deterministic match E2E')

    for (const row of subjects) subjectYears.set(row.detail.title, row.detail.year)
    cmsHitTitle = subjects[0].detail.title

    async function replaceSites (rows) {
      const payload = JSON.stringify(rows)
      const ok = await evaluate(`new Promise((resolve, reject) => {
        const request = indexedDB.open('zy')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('sites', 'readwrite')
          const store = tx.objectStore('sites')
          store.clear()
          for (const row of ${payload}) store.add(row)
          tx.oncomplete = () => { db.close(); resolve(true) }
          tx.onerror = () => reject(tx.error)
        }
      })`)
      assert.strictEqual(ok, true)
    }

    function cmsSite () {
      return {
        key: 'cms-e2e',
        name: 'CMS E2E',
        api: base + '/cms',
        type: 0,
        sourceKind: 'cms',
        group: 'CMS',
        isActive: true,
        reverseOrder: false
      }
    }

    function bdSite (suffix, delayKind) {
      return {
        key: 'csp_e2e_' + suffix,
        name: 'BD E2E ' + suffix,
        api: 'csp_e2e_' + suffix,
        ext: base + (delayKind === 'slow' ? '/mock-slow.js' : '/mock-fast.js'),
        type: 3,
        sourceKind: 'myvideo',
        network: 'native',
        group: 'CatVod/MyVideo',
        isActive: true,
        reverseOrder: true
      }
    }

    const doubanExpression = `(() => {
      const root = document.querySelector('#app').__vue__
      const seen = new Set()
      function walk (component) {
        if (!component || seen.has(component)) return null
        seen.add(component)
        if (String(component.$options && component.$options.name).toLowerCase() === 'douban') return component
        for (const child of (component.$children || [])) {
          const found = walk(child)
          if (found) return found
        }
        return null
      }
      return walk(root)
    })()`

    async function runSubject (row) {
      const payload = JSON.stringify(row.item)
      await evaluate(`(async () => {
        const component = ${doubanExpression}
        await component.selectSubject(${payload})
        return true
      })()`)
      let state = null
      let sawEarlyFirstPlayable = false
      for (let index = 0; index < 160; index++) {
        const raw = await evaluate(`(() => {
          const component = ${doubanExpression}
          return JSON.stringify(component.scanState)
        })()`)
        state = JSON.parse(raw)
        if (state.status === 'scanning' && state.firstPlayable) sawEarlyFirstPlayable = true
        if (state.status === 'complete') return { state, sawEarlyFirstPlayable }
        await sleep(100)
      }
      throw new Error('Douban scan did not complete: ' + JSON.stringify(state))
    }

    await replaceSites([cmsSite(), bdSite('fast', 'fast'), bdSite('slow', 'slow')])
    const cmsRun = await runSubject(subjects[0])
    const cmsState = cmsRun.state
    assert.strictEqual(cmsState.status, 'complete')
    assert(cmsState.top5.length > 0, 'CMS scenario returned no playable provider')
    assert.strictEqual(cmsState.top5[0].providerKind, 'CMS')
    assert.strictEqual(cmsState.bdCompleted, 0, 'BD fallback ran despite a verified CMS match')
    assert.strictEqual(cmsState.firstPlayable.providerKind, 'CMS')

    await replaceSites([cmsSite(), bdSite('fast', 'fast'), bdSite('slow', 'slow')])
    const bdRun = await runSubject(subjects[1])
    const bdState = bdRun.state
    assert.strictEqual(bdState.status, 'complete')
    assert(bdState.top5.length >= 2, 'BD exhaustive scan did not retain both playable providers')
    assert.strictEqual(bdState.top5[0].providerKind, 'BD')
    assert.strictEqual(bdState.cmsCompleted, 1)
    assert.strictEqual(bdState.bdCompleted, 2, 'BD fallback stopped before exhaustive completion')
    assert.strictEqual(bdState.firstPlayable.providerKind, 'BD')
    assert.strictEqual(bdRun.sawEarlyFirstPlayable, true, 'First playable was not surfaced before exhaustive BD completion')

    console.log(JSON.stringify({
      cms: {
        title: subjects[0].detail.title,
        provider: cmsState.top5[0].site.name,
        bdCompleted: cmsState.bdCompleted
      },
      fallback: {
        title: subjects[1].detail.title,
        provider: bdState.top5[0].site.name,
        cmsCompleted: bdState.cmsCompleted,
        bdCompleted: bdState.bdCompleted,
        earlyFirstPlayable: bdRun.sawEarlyFirstPlayable
      }
    }, null, 2))
  } finally {
    if (cdp) cdp.socket.close()
    child.kill()
    await sleep(500)
    server.close()
    fs.rmSync(profile, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
