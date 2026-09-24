'use strict'

const assert = require('assert')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const WebSocket = require('ws')

const defaultExe = path.resolve(__dirname, '..', 'dist_electron', 'win-unpacked', 'MY-ZYPlayer.exe')
const exe = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : defaultExe
const useInPlace = process.argv.includes('--in-place')
const TINY_MP4 = Buffer.from('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', 'base64')
const port = 9231
const profile = path.join(os.tmpdir(), 'my-zyplayer-e2e-' + process.pid)
const isolatedApp = path.join(os.tmpdir(), 'my-zyplayer-app-e2e-' + process.pid)

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

function startMockServer () {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      server.e2eStats = server.e2eStats || { videoRequests: 0, playbackHeader: '' }
      const origin = 'http://127.0.0.1:' + server.address().port
      const target = new URL(req.url, origin)
      if (target.pathname === '/video.mp4') {
        server.e2eStats.videoRequests++
        server.e2eStats.playbackHeader = req.headers['x-e2e-playback'] || ''
        const range = String(req.headers.range || '')
        const match = range.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = Number(match[1])
          const requestedEnd = match[2] ? Number(match[2]) : TINY_MP4.length - 1
          const end = Math.min(requestedEnd, TINY_MP4.length - 1)
          const body = TINY_MP4.slice(start, end + 1)
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Length': body.length,
            'Content-Range': 'bytes ' + start + '-' + end + '/' + TINY_MP4.length,
            'Accept-Ranges': 'bytes'
          })
          res.end(body)
          return
        }
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': TINY_MP4.length,
          'Accept-Ranges': 'bytes'
        })
        res.end(TINY_MP4)
        return
      }
      if (target.pathname === '/mock-fast.js' || target.pathname === '/mock-slow.js') {
        const slow = target.pathname === '/mock-slow.js'
        const label = slow ? 'SLOW' : 'FAST'
        const delay = slow ? 1200 : 25
        const code = [
          'const BASE=' + JSON.stringify(origin),
          'const LABEL=' + JSON.stringify(label),
          'const DELAY=' + delay,
          'async function getConfig(){ return jsonify({title:LABEL,tabs:[{name:"首页",ext:{id:"home"}}]}) }',
          'async function getCards(p){ p=argsify(p)||{}; if(DELAY) await new Promise(resolve=>setTimeout(resolve,DELAY)); const page=Number(p.page)||1; const list=page===1?Array.from({length:12},(_,i)=>({vod_id:LABEL+"-"+i,vod_name:LABEL+"-"+i,vod_year:"2026",type_name:"测试",ext:{id:LABEL+"-"+i,label:LABEL}})):[]; return jsonify({list,page,over:1}) }',
          'async function getTracks(p){ p=argsify(p)||{}; const id=String(p.id||"item"); return jsonify({detail:{vod_name:LABEL+" detail",vod_year:"2026",type_name:"测试"},list:[{title:"本地线路",tracks:[{name:"正片",ext:{url:BASE+"/video.mp4",id}}]}]}) }',
          'async function getPlayinfo(p){ p=argsify(p)||{}; return jsonify({urls:[String(p.url||(p.ext&&p.ext.url)||BASE+"/video.mp4")],headers:[{"X-E2E-Playback":"yes"}]}) }',
          'async function search(p){ p=argsify(p)||{}; return jsonify({list:[{vod_id:LABEL+"-search",vod_name:String(p.text||LABEL),vod_year:"2026",ext:{id:LABEL+"-search"}}],page:1,over:1}) }'
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
  const server = await startMockServer()
  const base = 'http://127.0.0.1:' + server.address().port
  fs.rmSync(profile, { recursive: true, force: true })
  fs.rmSync(isolatedApp, { recursive: true, force: true })
  let isolatedExe = exe
  let launchDir = path.dirname(exe)
  if (!useInPlace) {
    fs.cpSync(path.dirname(exe), isolatedApp, { recursive: true })
    isolatedExe = path.join(isolatedApp, 'MY-ZYPlayer.exe')
    launchDir = isolatedApp
  }

  const child = spawn(isolatedExe, [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile
  ], {
    cwd: launchDir,
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
      await sleep(100)
    }

    const mockSites = [
      {
        key: 'csp_e2e_fast',
        name: 'E2E 快源',
        api: 'csp_e2e_fast',
        ext: base + '/mock-fast.js',
        type: 3,
        sourceKind: 'myvideo',
        network: 'native',
        group: 'CatVod/MyVideo',
        isActive: true,
        reverseOrder: true
      },
      {
        key: 'csp_e2e_slow',
        name: 'E2E 慢源',
        api: 'csp_e2e_slow',
        ext: base + '/mock-slow.js',
        type: 3,
        sourceKind: 'myvideo',
        network: 'native',
        group: 'CatVod/MyVideo',
        isActive: true,
        reverseOrder: true
      }
    ]
    const stored = await evaluate(
      "new Promise((resolve,reject)=>{" +
      "const request=indexedDB.open('zy');" +
      "request.onerror=()=>reject(request.error);" +
      "request.onsuccess=()=>{" +
      "const db=request.result;const tx=db.transaction('sites','readwrite');const store=tx.objectStore('sites');" +
      "store.clear();const rows=" + JSON.stringify(mockSites) + ";for(const row of rows)store.add(row);" +
      "tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}" +
      "})"
    )
    assert.strictEqual(stored, true)
    await evaluate('location.reload(); true')
    await sleep(1000)

    const stateExpression =
      "(() => {" +
      "const rootElement=document.querySelector('#app');" +
      "const root=rootElement&&rootElement.__vue__;" +
      "const app=root&&root.$children&&root.$children[0];if(!app)return null;" +
      "const film=app.$children.find(component=>String(component.$options.name).toLowerCase()==='film');if(!film)return null;" +
      "return JSON.stringify({" +
      "site:film.site&&{key:film.site.key,name:film.site.name}," +
      "selectedSiteName:film.selectedSiteName,classListLen:film.classList.length,listLen:film.list.length," +
      "filteredLen:film.filteredList.length,cards:document.querySelectorAll('#film .card').length," +
      "cardNames:Array.from(document.querySelectorAll('#film .card .name')).map(node=>node.innerText)," +
      "firstCard:document.querySelector('#film .card .name')&&document.querySelector('#film .card .name').innerText," +
      "statusText:film.statusText,generation:film.listGeneration" +
      "})})()"

    let defaultState = null
    for (let index = 0; index < 100; index++) {
      const value = await evaluate(stateExpression)
      if (value) {
        defaultState = JSON.parse(value)
        if (defaultState.site && ['csp_e2e_fast', 'csp_e2e_slow'].includes(defaultState.site.key) && defaultState.filteredLen > 0 && defaultState.cards > 0) break
      }
      await sleep(100)
    }
    assert(defaultState, 'Mock-source Vue app did not become ready')
    assert(['csp_e2e_fast', 'csp_e2e_slow'].includes(defaultState.site.key), 'Unexpected initial mock source')
    assert(defaultState.filteredLen > 0, 'Explicit first-page load returned no data')
    assert(defaultState.cards > 0, 'Explicit first-page load rendered no DOM cards')
    const initialPrefix = defaultState.site.key === 'csp_e2e_fast' ? 'FAST-' : 'SLOW-'
    assert(defaultState.cardNames.every(name => name.startsWith(initialPrefix)), 'Unexpected data in initial mock source')

    const elementIconsLoaded = await evaluate("document.fonts ? document.fonts.check('16px element-icons') : true")
    assert.strictEqual(elementIconsLoaded, true, 'Element UI icon font did not load')

    // Full sidebar navigation smoke: every visible navigation item must switch
    // the Vuex view and render the matching component without breaking the app.
    const navigationCases = [
      ['电影', 'Film', 'film'],
      ['豆瓣', 'Douban', 'douban'],
      ['播放', 'Play', 'play'],
      ['收藏', 'Star', 'star'],
      ['历史记录', 'History', 'history'],
      ['源管理', 'EditSites', 'editsites'],
      ['设置', 'Setting', 'setting']
    ]
    for (const [title, expectedView, componentName] of navigationCases) {
      const clickedNav = await evaluate(
        "(() => {const node=Array.from(document.querySelectorAll('.aside span.zy-svg')).find(el=>{const t=el.querySelector('title');return t&&t.textContent===" +
        JSON.stringify(title) +
        "});if(!node)return false;node.click();return true})()"
      )
      assert.strictEqual(clickedNav, true, 'Navigation item not found: ' + title)
      let navState = null
      for (let retry = 0; retry < 40; retry++) {
        const raw = await evaluate(
          "(() => {const root=document.querySelector('#app').__vue__;const app=root&&root.$children&&root.$children[0];if(!app)return null;" +
          "const candidates=[root,app].concat(app.$children||[]);const target=candidates.find(c=>String(c&&c.$options&&c.$options.name).toLowerCase()===" +
          JSON.stringify(componentName) +
          ");return JSON.stringify({view:app.$store.state.view,found:!!target,display:target&&target.$el?getComputedStyle(target.$el).display:null})})()"
        )
        if (raw) {
          navState = JSON.parse(raw)
          if (navState.view === expectedView && navState.found && navState.display !== 'none') break
        }
        await sleep(50)
      }
      assert(navState, 'Navigation state unavailable: ' + title)
      assert.strictEqual(navState.view, expectedView, 'Navigation view mismatch for ' + title)
      assert.strictEqual(navState.found, true, 'Navigation component missing for ' + title)
      assert.notStrictEqual(navState.display, 'none', 'Navigation component remained hidden for ' + title)
    }
    // Continue the functional E2E from the main Film page.
    await evaluate(
      "(() => {const node=Array.from(document.querySelectorAll('.aside span.zy-svg')).find(el=>{const t=el.querySelector('title');return t&&t.textContent==='电影'});if(node)node.click();return true})()"
    )
    await sleep(100)

    async function selectSiteByDom (name) {
      const inputRect = JSON.parse(await evaluate(
        "(() => {const el=document.querySelector('#film .listpage-header > .el-select .el-input');if(!el)return null;" +
        "const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"
      ))
      assert(inputRect, 'Source selector did not exist')
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: inputRect.x, y: inputRect.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: inputRect.x, y: inputRect.y, button: 'left', clickCount: 1 })
      await sleep(160)
      const optionRect = JSON.parse(await evaluate(
        "(() => {const name=" + JSON.stringify(name) + ";" +
        "const items=Array.from(document.querySelectorAll('#film .el-select-dropdown__item'));" +
        "const item=items.find(node=>node.textContent.trim()===name&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);" +
        "if(!item)return null;const r=item.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"
      ))
      assert(optionRect, 'Visible source option not found: ' + name)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: optionRect.x, y: optionRect.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: optionRect.x, y: optionRect.y, button: 'left', clickCount: 1 })
    }

    await selectSiteByDom('E2E 快源')
    let fastBaseline = null
    for (let index = 0; index < 100; index++) {
      const value = await evaluate(stateExpression)
      if (value) {
        fastBaseline = JSON.parse(value)
        if (fastBaseline.site && fastBaseline.site.key === 'csp_e2e_fast' && fastBaseline.filteredLen > 0 && fastBaseline.cards > 0) break
      }
      await sleep(100)
    }
    assert(fastBaseline && fastBaseline.site && fastBaseline.site.key === 'csp_e2e_fast', 'Could not establish fast-source baseline')
    assert(fastBaseline.cardNames.length > 0 && fastBaseline.cardNames.every(name => name.startsWith('FAST-')), 'Fast-source baseline contained unexpected cards')

    await selectSiteByDom('E2E 慢源')
    await sleep(75)
    await selectSiteByDom('E2E 快源')

    let switchedState = null
    for (let index = 0; index < 80; index++) {
      const value = await evaluate(stateExpression)
      if (value) {
        switchedState = JSON.parse(value)
        if (switchedState.site && switchedState.site.key === 'csp_e2e_fast' && switchedState.filteredLen > 0 && switchedState.cards > 0) break
      }
      await sleep(100)
    }
    assert(switchedState, 'Rapid switch produced no state')
    assert.strictEqual(switchedState.site.key, 'csp_e2e_fast')
    assert(switchedState.filteredLen > 0, 'Fast source did not explicitly load its first page')
    assert(switchedState.cardNames.length > 0, 'Fast source did not render cards')
    assert(switchedState.cardNames.every(name => name.startsWith('FAST-')), 'Stale slow-source results polluted the fast source')
    assert.notStrictEqual(switchedState.statusText, '源加载失败', 'Old source failure status leaked into new source')

    const clicked = await evaluate(
      "(() => {const element=document.querySelector('#film .card .name');if(!element)return false;element.click();return true})()"
    )
    assert.strictEqual(clicked, true)
    await sleep(500)
    const detail = JSON.parse(await evaluate(
      "(() => {const app=document.querySelector('#app').__vue__.$children[0];return JSON.stringify({" +
      "show:app.$store.state.detail.show,key:app.$store.state.detail.key,visible:!!document.querySelector('.detail')})})()"
    ))
    assert.strictEqual(detail.show, true)
    assert.strictEqual(detail.key, 'csp_e2e_fast')
    assert.strictEqual(detail.visible, true)

    async function clickSelectorWithCdp (selector) {
      const rect = JSON.parse(await evaluate(
        "(() => {const el=document.querySelector(" + JSON.stringify(selector) + ");if(!el)return null;" +
        "const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"
      ))
      assert(rect, 'Unable to locate clickable element: ' + selector)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    }

    async function clickRectExpression (rectExpression, label) {
      const raw = await evaluate(rectExpression)
      const rect = raw ? JSON.parse(raw) : null
      assert(rect, 'Unable to locate clickable element: ' + label)
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 })
    }

    async function clickVisibleButton (text, rowText = '') {
      const expression = "(() => {const text=" + JSON.stringify(text) + ";const rowText=" + JSON.stringify(rowText) + ";" +
        "const visible=node=>node&&node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0;" +
        "let nodes=[];if(!rowText){const dialogs=Array.from(document.querySelectorAll('.el-dialog')).filter(visible);" +
        "const dialog=dialogs[dialogs.length-1];if(dialog)nodes=Array.from(dialog.querySelectorAll('button')).filter(visible)}" +
        "if(!nodes.length)nodes=Array.from(document.querySelectorAll('button')).filter(visible);" +
        "const el=nodes.find(node=>node.textContent.trim()===text&&(!rowText||(node.closest('.el-table__row')&&node.closest('.el-table__row').textContent.includes(rowText))));" +
        "if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"
      await clickRectExpression(expression, (rowText ? rowText + ' / ' : '') + text)
    }

    async function typeDialogField (label, text) {
      const expression = "(() => {const label=" + JSON.stringify(label) + ";" +
        "const dialogs=Array.from(document.querySelectorAll('.el-dialog')).filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);" +
        "const dialog=dialogs[dialogs.length-1];if(!dialog)return null;" +
        "const item=Array.from(dialog.querySelectorAll('.el-form-item')).find(node=>{const l=node.querySelector('.el-form-item__label');return l&&l.textContent.trim()===label});" +
        "const el=item&&item.querySelector('input,textarea');if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()"
      await clickRectExpression(expression, 'dialog field ' + label)
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0 })
      await cdp.send('Input.insertText', { text })
      const value = await evaluate("document.activeElement && document.activeElement.value")
      assert.strictEqual(value, text, 'CDP input did not populate field ' + label)
    }

    async function readSiteByKey (key) {
      const raw = await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('zy');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('sites','readonly');const get=tx.objectStore('sites').getAll();get.onsuccess=()=>{const row=get.result.find(item=>item.key===" + JSON.stringify(key) + ")||null;db.close();resolve(JSON.stringify(row))};get.onerror=()=>reject(get.error)}})")
      return raw ? JSON.parse(raw) : null
    }

    await clickSelectorWithCdp('.detail .m3u8 .box span')
    const playStateExpression =
      "(() => {const root=document.querySelector('#app').__vue__.$children[0];const video=document.querySelector('#xgplayer video');" +
      "return JSON.stringify({view:root.$store.getters.getView,video:!!video,readyState:video?video.readyState:0," +
      "currentTime:video?video.currentTime:0,duration:video?video.duration:0,videoWidth:video?video.videoWidth:0," +
      "paused:video?video.paused:true,ended:video?video.ended:false,src:video?video.currentSrc:''})})()"
    let playState = null
    for (let index = 0; index < 100; index++) {
      const value = await evaluate(playStateExpression)
      if (value) {
        playState = JSON.parse(value)
        if (playState.view === 'Play' && playState.video && playState.readyState >= 2 && playState.videoWidth > 0) break
      }
      await sleep(100)
    }
    assert(playState && playState.view === 'Play', 'Player view did not open')
    assert(playState.video, 'HTML5 video element was not created')
    assert(playState.readyState >= 2, 'Video never reached current-data/first-frame readiness')
    assert(playState.videoWidth > 0, 'Decoded video frame dimensions are unavailable')
    assert(playState.duration > 0, 'Media duration was not detected')
    assert(server.e2eStats.videoRequests > 0, 'Media bytes were never requested')
    assert.strictEqual(server.e2eStats.playbackHeader, 'yes', 'Playback request headers were not applied')

    const pausedState = JSON.parse(await evaluate(
      "(() => {const video=document.querySelector('#xgplayer video');video.currentTime=Math.min(0.35,video.duration/2);video.pause();" +
      "return JSON.stringify({paused:video.paused,currentTime:video.currentTime})})()"
    ))
    assert.strictEqual(pausedState.paused, true)
    assert(pausedState.currentTime > 0, 'Seek did not move playback position')
    const resumedState = JSON.parse(await evaluate(
      "(async()=>{const video=document.querySelector('#xgplayer video');await video.play();await new Promise(resolve=>setTimeout(resolve,120));" +
      "return JSON.stringify({paused:video.paused,currentTime:video.currentTime,readyState:video.readyState})})()"
    ))
    assert.strictEqual(resumedState.paused, false)
    assert(resumedState.readyState >= 2)

    await clickRectExpression(
      "(() => {const el=Array.from(document.querySelectorAll('span.zy-svg')).find(node=>{const title=node.querySelector('title');return title&&title.textContent==='源管理'});" +
      "if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()",
      '源管理'
    )
    for (let index = 0; index < 50; index++) {
      if (await evaluate("!!document.querySelector('#sites')")) break
      await sleep(100)
    }
    assert.strictEqual(await evaluate("!!document.querySelector('#sites')"), true, 'Source manager did not open')
    await clickVisibleButton('新增 CMS')
    await sleep(150)
    assert.strictEqual(await evaluate("Array.from(document.querySelectorAll('.el-dialog')).some(node=>node.getBoundingClientRect().width>0&&node.textContent.includes('新增 CMS 源'))"), true, 'Add CMS dialog did not open')
    await typeDialogField('源站名', 'E2E Manual CMS')
    await typeDialogField('API接口', base + '/cms-api')
    await typeDialogField('源站标识', 'e2e-manual-cms')
    const addFormState = JSON.parse(await evaluate("(() => {const root=document.querySelector('#app').__vue__;const seen=new Set();function walk(c){if(!c||seen.has(c))return null;seen.add(c);if(String(c.$options&&c.$options.name).toLowerCase()==='editsites')return c;for(const child of(c.$children||[])){const found=walk(child);if(found)return found}return null}const c=walk(root);return JSON.stringify(c&&c.siteInfo)})()"))
    assert(addFormState, 'EditSites component not found while adding CMS')
    assert.strictEqual(addFormState.name, 'E2E Manual CMS')
    assert.strictEqual(addFormState.api, base + '/cms-api')
    assert.strictEqual(addFormState.key, 'e2e-manual-cms')
    const saveButtonDebug = JSON.parse(await evaluate("(() => {const dialogs=Array.from(document.querySelectorAll('.el-dialog')).filter(node=>node.getBoundingClientRect().width>0&&node.getBoundingClientRect().height>0);const dialog=dialogs[dialogs.length-1];const el=dialog&&Array.from(dialog.querySelectorAll('button')).find(node=>node.textContent.trim()==='保存');if(!el)return JSON.stringify(null);const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return JSON.stringify({disabled:el.disabled,rect:{left:r.left,top:r.top,width:r.width,height:r.height},hitTag:hit&&hit.tagName,hitText:hit&&hit.textContent,hitClass:hit&&hit.className,same:hit===el,contained:hit&&el.contains(hit)})})()"))
    assert(saveButtonDebug && !saveButtonDebug.disabled, 'Save button unavailable: ' + JSON.stringify(saveButtonDebug))
    await clickVisibleButton('保存')
    await sleep(250)
    const afterSaveState = JSON.parse(await evaluate("(() => {const root=document.querySelector('#app').__vue__;const seen=new Set();function walk(c){if(!c||seen.has(c))return null;seen.add(c);if(String(c.$options&&c.$options.name).toLowerCase()==='editsites')return c;for(const child of(c.$children||[])){const found=walk(child);if(found)return found}return null}const c=walk(root);return JSON.stringify(c&&{dialogVisible:c.editSiteDialogVisible,dialogType:c.dialogType,siteInfo:c.siteInfo,sites:c.sites.map(row=>({id:row.id,key:row.key,name:row.name}))})})()"))

    let manualCms = null
    for (let index = 0; index < 50; index++) {
      manualCms = await readSiteByKey('e2e-manual-cms')
      if (manualCms) break
      await sleep(100)
    }
    if (!manualCms) {
      const rowsJson = await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('zy');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('sites','readonly');const get=tx.objectStore('sites').getAll();get.onsuccess=()=>{db.close();resolve(JSON.stringify(get.result))};get.onerror=()=>reject(get.error)}})")
      throw new Error('New CMS was not persisted. form=' + JSON.stringify(addFormState) + ' saveButton=' + JSON.stringify(saveButtonDebug) + ' after=' + JSON.stringify(afterSaveState) + ' rows=' + rowsJson)
    }
    assert.strictEqual(manualCms.name, 'E2E Manual CMS')
    assert.strictEqual(manualCms.type, 0)
    assert.strictEqual(manualCms.sourceKind, 'cms')
    assert.strictEqual(manualCms.network, 'native')
    assert.strictEqual(manualCms.group, 'CMS')
    assert.strictEqual(manualCms.isActive, true)

    await clickRectExpression(
      "(() => {const row=Array.from(document.querySelectorAll('#sites .el-table__row')).find(node=>node.textContent.includes('E2E Manual CMS'));" +
      "const el=row&&row.querySelector('.el-switch');if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()",
      'CMS enable switch'
    )
    for (let index = 0; index < 30; index++) {
      manualCms = await readSiteByKey('e2e-manual-cms')
      if (manualCms && manualCms.isActive === false) break
      await sleep(100)
    }
    assert.strictEqual(manualCms.isActive, false, 'CMS enable/disable was not persisted')

    await clickVisibleButton('编辑', 'E2E Manual CMS')
    await sleep(120)
    await typeDialogField('源站名', 'E2E Manual CMS Edited')
    await clickVisibleButton('保存')
    for (let index = 0; index < 30; index++) {
      manualCms = await readSiteByKey('e2e-manual-cms')
      if (manualCms && manualCms.name === 'E2E Manual CMS Edited') break
      await sleep(100)
    }
    assert.strictEqual(manualCms.name, 'E2E Manual CMS Edited', 'CMS edit was not persisted')
    assert.strictEqual(manualCms.isActive, false, 'CMS edit lost enable/disable state')

    // Element UI keeps the modal transition active briefly after the edit dialog closes.
    // Wait until the real user-facing overlay is gone before clicking the table beneath it.
    for (let index = 0; index < 20; index++) {
      const modalVisible = await evaluate("Array.from(document.querySelectorAll('.v-modal')).some(node=>getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden'&&Number(getComputedStyle(node).opacity||1)>0)")
      if (!modalVisible) break
      await sleep(50)
    }
    await clickVisibleButton('删除', 'E2E Manual CMS Edited')
    for (let index = 0; index < 30; index++) {
      manualCms = await readSiteByKey('e2e-manual-cms')
      if (!manualCms) break
      await sleep(100)
    }
    assert.strictEqual(manualCms, null, 'CMS delete was not persisted')

    const sourceManagerResult = { added: true, toggled: true, edited: true, deleted: true }

    console.log(JSON.stringify({
      firstPage: {
        site: fastBaseline.site,
        cards: fastBaseline.cards,
        firstCard: fastBaseline.firstCard
      },
      elementIconsLoaded,
      rapidSwitch: {
        site: switchedState.site,
        cards: switchedState.cards,
        generation: switchedState.generation,
        stalePollution: false
      },
      detailOpened: detail.visible,
      sourceManager: sourceManagerResult,
      playback: {
        firstFrameReady: playState.readyState >= 2 && playState.videoWidth > 0,
        duration: playState.duration,
        videoWidth: playState.videoWidth,
        mediaRequests: server.e2eStats.videoRequests,
        playbackHeader: server.e2eStats.playbackHeader,
        seekTime: pausedState.currentTime,
        resumed: !resumedState.paused
      }
    }, null, 2))
  } finally {
    if (cdp) cdp.socket.close()
    child.kill()
    await sleep(500)
    server.close()
    fs.rmSync(profile, { recursive: true, force: true })
    if (!useInPlace) fs.rmSync(isolatedApp, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
