'use strict'

const assert = require('assert')
const { createPlaybackNetworkPolicy } = require('../src/main/playback/network-policy')

let now = 1000
const policy = createPlaybackNetworkPolicy({ now: () => now, defaultTtlMs: 1000 })

const scopeId = policy.registerScope({
  url: 'https://media.example.com/show/ep1/master.m3u8',
  pathPrefix: '/show/ep1/',
  headers: { Referer: 'https://example.com/', 'X-Test': 'yes' }
})

assert.strictEqual(typeof scopeId, 'string')
assert(scopeId.length > 0)

assert.deepStrictEqual(
  policy.applyRequest('https://media.example.com/show/ep1/seg.ts', { Range: 'bytes=0-' }),
  { Range: 'bytes=0-', Referer: 'https://example.com/', 'X-Test': 'yes' }
)
assert.deepStrictEqual(
  policy.applyRequest('https://media.example.com/show/ep2/seg.ts', { Range: 'bytes=0-' }),
  { Range: 'bytes=0-' }
)
assert.deepStrictEqual(
  policy.applyRequest('https://other.example.com/show/ep1/seg.ts', { Range: 'bytes=0-' }),
  { Range: 'bytes=0-' }
)

const responseHeaders = policy.applyResponse(
  'https://media.example.com/show/ep1/seg.ts',
  { 'content-type': ['video/mp2t'] }
)
assert.deepStrictEqual(responseHeaders['access-control-allow-origin'], ['*'])
assert.deepStrictEqual(responseHeaders['access-control-allow-headers'], ['*'])
assert.deepStrictEqual(responseHeaders['access-control-expose-headers'], ['*'])

const unrelatedResponse = { 'content-type': ['video/mp2t'] }
assert.deepStrictEqual(
  policy.applyResponse('https://media.example.com/show/ep2/seg.ts', unrelatedResponse),
  unrelatedResponse
)

now = 2501
assert.deepStrictEqual(
  policy.applyRequest('https://media.example.com/show/ep1/seg.ts', {}),
  {}
)

const second = policy.registerScope({
  url: 'https://cdn.example.com/a/master.m3u8',
  headers: { 'X-Other': '1' }
})
assert.deepStrictEqual(policy.applyRequest('https://cdn.example.com/a/seg.ts', {}), { 'X-Other': '1' })
assert.strictEqual(policy.clearScope(second), true)
assert.deepStrictEqual(policy.applyRequest('https://cdn.example.com/a/seg.ts', {}), {})

assert.throws(
  () => policy.registerScope({ url: 'file:///tmp/a', headers: { X: '1' } }),
  /http/i
)

console.log('Playback network policy tests passed')
