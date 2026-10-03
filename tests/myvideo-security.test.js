'use strict'

const assert = require('assert')
const http = require('http')
const path = require('path')
const {
  assertPublicHttpTarget,
  isBlockedAddress
} = require('../src/main/security/network-target')
const {
  NativeHttpClient,
  SourceWorker,
  RuntimeManager,
  dynamicCodePolicy,
  runtimeIdentity,
  sha256Text
} = require('../src/main/myvideo/runtime')

async function expectReject (promise, pattern) {
  let error = null
  try {
    await promise
  } catch (caught) {
    error = caught
  }
  assert(error, 'Expected rejection')
  assert(pattern.test(String(error.message)), 'Unexpected rejection: ' + error.message)
}

async function main () {
  await expectReject(assertPublicHttpTarget('file:///tmp/a'), /http/i)
  await expectReject(assertPublicHttpTarget('javascript:alert(1)'), /http/i)
  await expectReject(assertPublicHttpTarget('http://127.0.0.1/a'), /private|loopback|blocked/i)
  await expectReject(assertPublicHttpTarget('http://[::1]/a'), /private|loopback|blocked/i)
  await expectReject(assertPublicHttpTarget('http://169.254.169.254/latest/meta-data'), /private|link|blocked/i)

  await expectReject(
    assertPublicHttpTarget('https://internal.example/a', {
      lookup: async () => [{ address: '10.20.30.40', family: 4 }]
    }),
    /private|blocked/i
  )

  const publicUrl = await assertPublicHttpTarget('https://public.example/a', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }]
  })
  assert.strictEqual(publicUrl.hostname, 'public.example')

  assert.strictEqual(isBlockedAddress('192.168.1.1'), true)
  assert.strictEqual(isBlockedAddress('172.20.1.1'), true)
  assert.strictEqual(isBlockedAddress('8.8.8.8'), false)
  assert.strictEqual(isBlockedAddress('fc00::1'), true)
  assert.strictEqual(isBlockedAddress('2001:4860:4860::8888'), false)

  assert.strictEqual(
    sha256Text('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )

  const pinnedScript = 'async function getConfig(){ return jsonify({title:"pinned"}) }'
  const pinManager = new RuntimeManager({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    loader: {
      get: async url => url.endsWith('/TV.json')
        ? { status: 200, url, data: [{ type: 3, key: 'pinned', api: 'csp_pinned', ext: 'https://public.example/source.js' }] }
        : { status: 200, url, data: pinnedScript }
    }
  })
  const pinnedConfig = await pinManager.loadConfig('https://public.example/TV.json')
  assert.strictEqual(pinnedConfig[0].sha256, sha256Text(pinnedScript), 'Config import must pin remote source scripts before they are stored')
  assert.strictEqual(pinnedConfig[0].integrityRequired, true)

  const source = {
    key: 'source-a',
    ext: 'https://public.example/source.js',
    network: 'native',
    config: { a: 1 }
  }
  const id1 = runtimeIdentity(source, 'a'.repeat(64))
  const id2 = runtimeIdentity(source, 'b'.repeat(64))
  assert.notStrictEqual(id1, id2)
  assert(id1.includes('a'.repeat(64)))

  assert.strictEqual(dynamicCodePolicy({ ext: 'https://public.example/ordinary.js', allowDynamicCode: true }).enabled, false)
  assert.strictEqual(dynamicCodePolicy({ ext: 'https://public.example/7sefun.js' }).enabled, true)

  const requested = []
  const validated = []
  const client = new NativeHttpClient({
    assertTarget: async raw => {
      const value = String(raw)
      validated.push(value)
      if (value.includes('127.0.0.1')) throw new Error('blocked private redirect')
      return new URL(value)
    },
    requestImpl: async config => {
      requested.push(config.url)
      return {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
        data: '',
        request: {}
      }
    }
  })

  await expectReject(client.get('https://public.example/start'), /private redirect/i)
  assert.deepStrictEqual(requested, ['https://public.example/start'])
  assert.deepStrictEqual(validated, [
    'https://public.example/start',
    'http://127.0.0.1/private'
  ])

  let redirectedHeaders = null
  let redirectStep = 0
  const redirectClient = new NativeHttpClient({
    assertTarget: async raw => new URL(String(raw)),
    requestImpl: async config => {
      redirectStep++
      if (redirectStep === 1) {
        return { status: 302, headers: { location: 'https://other.example/target' }, data: '', request: {} }
      }
      redirectedHeaders = config.headers
      return { status: 200, headers: {}, data: 'ok', request: {} }
    }
  })
  await redirectClient.get('https://origin.example/start', { headers: { Authorization: 'Bearer secret', Cookie: 'sid=secret', 'X-Normal': 'keep' } })
  assert.strictEqual(redirectedHeaders.Authorization, undefined, 'Cross-origin redirects must strip Authorization')
  assert.strictEqual(redirectedHeaders.Cookie, undefined, 'Cross-origin redirects must strip Cookie')
  assert.strictEqual(redirectedHeaders['X-Normal'], 'keep')

  const localServer = http.createServer((req, res) => res.end('local-secret'))
  await new Promise(resolve => localServer.listen(0, '127.0.0.1', resolve))
  const workerPath = path.resolve(__dirname, '../src/main/myvideo/runtime.worker.js')
  const modulePath = path.resolve(__dirname, '../node_modules')
  const sourceCode = `async function getConfig(){ return await $fetch.get('http://127.0.0.1:${localServer.address().port}/private') }`
  const sourceWorker = new SourceWorker(
    { key: 'private-network-test', name: 'private-network-test', ext: 'https://public.example/source.js', network: 'native' },
    sourceCode,
    { workerPath, modulePath, callTimeout: 2500 }
  )
  try {
    await expectReject(sourceWorker.call('getConfig'), /private|loopback|blocked|network/i)
  } finally {
    sourceWorker.terminate()
    await new Promise(resolve => localServer.close(resolve))
  }

  console.log('MyVideo source security tests passed')
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
