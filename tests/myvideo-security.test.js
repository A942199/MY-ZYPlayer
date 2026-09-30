'use strict'

const assert = require('assert')
const {
  assertPublicHttpTarget,
  isBlockedAddress
} = require('../src/main/security/network-target')
const {
  NativeHttpClient,
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

  console.log('MyVideo source security tests passed')
}

main().catch(error => {
  console.error(error && error.stack || error)
  process.exitCode = 1
})
