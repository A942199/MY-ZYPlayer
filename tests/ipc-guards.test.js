'use strict'

const assert = require('assert')
const {
  assertAllowedKeys,
  assertAppSender,
  assertHttpUrl,
  assertPlainObject
} = require('../src/main/ipc/guards')

const webContents = {}
const mainWindow = { webContents }

assert.strictEqual(assertAppSender({ sender: webContents }, mainWindow), true)
assert.throws(() => assertAppSender({ sender: {} }, mainWindow), /sender/i)

assert.deepStrictEqual(assertPlainObject({ a: 1 }, 'payload', 65536), { a: 1 })
assert.throws(() => assertPlainObject([], 'payload', 65536), /object/i)
assert.throws(() => assertPlainObject(null, 'payload', 65536), /object/i)
assert.throws(
  () => assertPlainObject({ value: 'x'.repeat(70 * 1024) }, 'payload', 65536),
  /large|size|bytes/i
)

assert.strictEqual(assertHttpUrl('https://example.com/a', 'url').protocol, 'https:')
assert.strictEqual(assertHttpUrl('http://example.com/a', 'url').protocol, 'http:')
assert.throws(() => assertHttpUrl('file:///tmp/a', 'url'), /http/i)
assert.throws(() => assertHttpUrl('javascript:alert(1)', 'url'), /http/i)

assert.deepStrictEqual(assertAllowedKeys({ a: 1 }, ['a']), { a: 1 })
assert.throws(() => assertAllowedKeys({ a: 1, b: 2 }, ['a']), /key/i)

console.log('IPC guard tests passed')
