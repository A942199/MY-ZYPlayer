'use strict'

const assert = require('assert')
const http = require('http')
const { createPlaybackMediaProxy } = require('../src/main/playback/media-proxy')

function listen (server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function fetchBuffer (url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }))
    })
    req.on('error', reject)
  })
}

async function main () {
  const seen = []
  const remote = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: { ...req.headers } })
    if (req.headers['x-provider'] !== 'yes') {
      res.statusCode = 403
      res.end('missing provider header')
      return
    }
    if (req.url === '/master.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.end([
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="/key.bin"',
        '#EXT-X-STREAM-INF:BANDWIDTH=1000000',
        '/variant.m3u8'
      ].join('\n'))
      return
    }
    if (req.url === '/variant.m3u8') {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.end([
        '#EXTM3U',
        '#EXTINF:4.0,',
        '/seg.ts',
        '#EXT-X-ENDLIST'
      ].join('\n'))
      return
    }
    if (req.url === '/key.bin') {
      res.setHeader('Content-Type', 'application/octet-stream')
      res.end(Buffer.from('0123456789abcdef'))
      return
    }
    if (req.url === '/seg.ts') {
      res.setHeader('Content-Type', 'video/mp2t')
      if (req.headers.range) {
        res.statusCode = 206
        res.setHeader('Content-Range', 'bytes 0-3/8')
        res.end(Buffer.from('SEGM'))
      } else {
        res.end(Buffer.from('SEGMENT!'))
      }
      return
    }
    if (req.url === '/movie.mp4') {
      res.setHeader('Content-Type', 'video/mp4')
      if (req.headers.range) {
        res.statusCode = 206
        res.setHeader('Content-Range', 'bytes 0-3/8')
        res.end(Buffer.from('MP4!'))
      } else {
        res.end(Buffer.from('MP4-DATA'))
      }
      return
    }
    res.statusCode = 404
    res.end('not found')
  })

  const remotePort = await listen(remote)
  const base = 'http://127.0.0.1:' + remotePort
  const proxy = createPlaybackMediaProxy({
    assertTarget: async value => new URL(String(value)),
    defaultTtlMs: 5000
  })

  try {
    const prepared = await proxy.prepare({
      url: base + '/master.m3u8',
      headers: { 'X-Provider': 'yes' }
    })
    assert(/^http:\/\/127\.0\.0\.1:\d+\/media\//.test(prepared.url))
    assert(prepared.scopeId)

    const master = await fetchBuffer(prepared.url)
    assert.strictEqual(master.status, 200)
    assert.strictEqual(master.headers['access-control-allow-origin'], '*')
    const masterText = master.body.toString('utf8')
    assert(!masterText.includes(base), 'Remote HLS URLs must not leak back to the renderer')
    const uriMatches = [...masterText.matchAll(/http:\/\/127\.0\.0\.1:\d+\/media\/[^"\s]+/g)].map(match => match[0])
    assert(uriMatches.length >= 2, 'Manifest URI attributes and nested manifests must be rewritten')

    const keyUrl = (masterText.match(/URI="([^"]+)"/) || [])[1]
    const variantUrl = masterText.split('\n').find(line => line && !line.startsWith('#'))
    assert(keyUrl)
    assert(variantUrl)

    const key = await fetchBuffer(keyUrl)
    assert.strictEqual(key.status, 200)
    assert.strictEqual(key.body.toString(), '0123456789abcdef')

    const variant = await fetchBuffer(variantUrl)
    assert.strictEqual(variant.status, 200)
    const segmentUrl = variant.body.toString('utf8').split('\n').find(line => line && !line.startsWith('#'))
    assert(segmentUrl && segmentUrl.startsWith('http://127.0.0.1:'))

    const segment = await fetchBuffer(segmentUrl, { Range: 'bytes=0-3' })
    assert.strictEqual(segment.status, 206)
    assert.strictEqual(segment.body.toString(), 'SEGM')
    const segmentSeen = seen.find(row => row.url === '/seg.ts')
    assert(segmentSeen)
    assert.strictEqual(segmentSeen.headers.range, 'bytes=0-3')
    assert.strictEqual(segmentSeen.headers['x-provider'], 'yes')

    const mp4 = await proxy.prepare({
      url: base + '/movie.mp4',
      headers: { 'X-Provider': 'yes' }
    })
    const partial = await fetchBuffer(mp4.url, { Range: 'bytes=0-3' })
    assert.strictEqual(partial.status, 206)
    assert.strictEqual(partial.body.toString(), 'MP4!')

    assert.strictEqual(proxy.release(prepared.scopeId), true)
    const released = await fetchBuffer(prepared.url)
    assert.strictEqual(released.status, 404)

    const unknown = prepared.url.replace(/\/media\/[^/]+\//, '/media/not-a-scope/')
    const unknownResponse = await fetchBuffer(unknown)
    assert.strictEqual(unknownResponse.status, 404)
  } finally {
    await proxy.stop()
    await new Promise(resolve => remote.close(resolve))
  }

  console.log('Playback media proxy tests passed')
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
