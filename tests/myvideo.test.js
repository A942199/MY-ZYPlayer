'use strict'

const assert = require('assert')
const http = require('http')
const path = require('path')
const cms = require('../src/lib/site/cms')
const myvideo = require('../src/lib/site/myvideo')
const { SourceWorker } = require('../src/main/myvideo/runtime')

const root = path.resolve(__dirname, '..')
const workerPath = path.join(root, 'src', 'main', 'myvideo', 'runtime.worker.js')
const modulePath = path.join(root, 'node_modules')

function listen (server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

async function testCms () {
  const json = cms.parse({
    class: [{ type_id: 1, type_name: '电影' }],
    page: 1,
    pagecount: 2,
    list: [{
      vod_id: 'v1',
      vod_name: 'JSON Movie',
      vod_play_from: 'line',
      vod_play_url: '第一集$https://example.test/a.m3u8'
    }]
  })
  assert.strictEqual(json.class.ty[0]._t, '电影')
  assert.strictEqual(json.list.video[0].id, 'v1')
  assert.strictEqual(json.list.video[0].dl.dd._flag, 'line')

  const xml = cms.parse('<?xml version="1.0"?><rss><class><ty id="2">剧集</ty></class><list page="1" pagecount="1" pagesize="1" recordcount="1"><video><id>x1</id><name>XML Movie</name><dl><dd flag="xml">第一集$https://example.test/x.m3u8</dd></dl></video></list></rss>')
  assert.strictEqual(xml.class.ty._t, '剧集')
  assert.strictEqual(xml.list.video.id, 'x1')
}

async function testTvImport () {
  const imported = myvideo.importSites({
    sites: [
      {
        name: 'JS',
        type: 3,
        api: 'csp_demo',
        ext: 'https://example.test/demo.js'
      },
      {
        name: 'CMS',
        type: 0,
        api: 'https://example.test/api.php'
      }
    ]
  }, 'https://example.test/TV.json')
  assert.strictEqual(imported.length, 2)
  assert.strictEqual(imported[0].sourceKind, 'myvideo')
  assert.strictEqual(imported[0].network, 'native')
  assert.strictEqual(imported[1].sourceKind, 'cms')
}

async function testRuntime () {
  let seenHeader = ''
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      if (req.url.startsWith('/get')) {
        seenHeader = req.headers['x-myvideo-test'] || ''
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.url === '/post') {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          body: Buffer.concat(chunks).toString('utf8'),
          header: req.headers['x-post-test'] || ''
        }))
        return
      }
      res.statusCode = 404
      res.end('not found')
    })
  })
  const port = await listen(server)
  const base = 'http://127.0.0.1:' + port
  const code = [
    'const BASE = ' + JSON.stringify(base),
    'async function getConfig(){ return jsonify({title:"test", processType:typeof process, requireType:typeof require}) }',
    'async function getCards(p){ p=argsify(p)||{}; const r=await $fetch.get(BASE+"/get",{headers:{"X-MyVideo-Test":"yes"}}); const parsed=JSON.parse(r.data); return jsonify({list:[{vod_id:"1",vod_name:String(parsed.ok),ext:{id:"1"}}],page:p.page||1}) }',
    'async function getTracks(){ return jsonify({list:[{title:"line",tracks:[{name:"ep1",ext:{url:BASE+"/video",ep:"1"}}]}]}) }',
    'async function getPlayinfo(){ const r=await $fetch.post(BASE+"/post",JSON.stringify({hello:"world"}),{headers:{"Content-Type":"application/json","X-Post-Test":"posted"}}); const parsed=JSON.parse(r.data); return jsonify({urls:["https://example.test/video.m3u8"],echo:{body:r.data.body||parsed.body,header:r.data.header||parsed.header}}) }',
    'async function search(p){ p=argsify(p)||{}; return jsonify({list:[{vod_id:"s",vod_name:p.text||"",ext:{id:"s"}}],page:1}) }'
  ].join('\n')

  const source = { key: 'test', name: 'test', ext: 'memory://test.js', network: 'native' }
  const runtime = new SourceWorker(source, code, { workerPath, modulePath, callTimeout: 2000 })
  try {
    const config = await runtime.call('getConfig')
    assert.strictEqual(config.title, 'test')
    assert.strictEqual(config.processType, 'undefined')
    assert.strictEqual(config.requireType, 'undefined')

    const cards = await runtime.call('getCards', { page: 2 })
    assert.strictEqual(cards.list[0].vod_name, 'true')
    assert.strictEqual(cards.page, 2)
    assert.strictEqual(seenHeader, 'yes')

    const tracks = await runtime.call('getTracks', { id: '1' })
    assert.strictEqual(tracks.list[0].tracks[0].name, 'ep1')

    const play = await runtime.call('getPlayinfo', {})
    assert.deepStrictEqual(play.urls, ['https://example.test/video.m3u8'])
    assert.strictEqual(JSON.parse(play.echo.body).hello, 'world')
    assert.strictEqual(play.echo.header, 'posted')

    const search = await runtime.call('search', { text: 'needle' })
    assert.strictEqual(search.list[0].vod_name, 'needle')
  } finally {
    runtime.terminate()
    server.close()
  }

  const timeoutRuntime = new SourceWorker(
    { key: 'timeout', name: 'timeout', ext: 'memory://timeout.js', network: 'native' },
    'async function getConfig(){ while(true){} }',
    { workerPath, modulePath, callTimeout: 300 }
  )
  let timeoutError = null
  try {
    await timeoutRuntime.call('getConfig')
  } catch (error) {
    timeoutError = error
  } finally {
    timeoutRuntime.terminate()
  }
  assert(timeoutError)
  assert.strictEqual(timeoutError.code, 'MYVIDEO_TIMEOUT')
}

async function main () {
  await testCms()
  await testTvImport()
  await testRuntime()
  console.log('MyVideo compatibility unit tests passed')
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
