'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createSecretStore, SECRET_KEYS } = require('../src/main/settings/secret-store')

function fakeSafeStorage (available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: value => Buffer.from('enc:' + value, 'utf8'),
    decryptString: buffer => {
      const value = buffer.toString('utf8')
      if (!value.startsWith('enc:')) throw new Error('decrypt failed')
      return value.slice(4)
    }
  }
}

async function main () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'myzy-secret-store-'))
  try {
    const unavailablePath = path.join(root, 'unavailable.json')
    const unavailable = createSecretStore({
      safeStorage: fakeSafeStorage(false),
      fs,
      filePath: unavailablePath
    })
    assert.deepStrictEqual(await unavailable.status(), { available: false, configured: {} })
    await assert.rejects(() => unavailable.update({ jimakuApiKey: 'secret' }), /unavailable/i)
    assert.strictEqual(fs.existsSync(unavailablePath), false)

    const filePath = path.join(root, 'secrets.json')
    const store = createSecretStore({
      safeStorage: fakeSafeStorage(true),
      fs,
      filePath
    })

    assert(SECRET_KEYS.includes('jimakuApiKey'))
    assert(SECRET_KEYS.includes('dandanplayAppSecret'))

    await store.update({
      jimakuApiKey: 'jimaku-1',
      dandanplayAppSecret: 'dandan-1'
    })
    assert.strictEqual(fs.existsSync(filePath), true)
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    assert.strictEqual(envelope.version, 1)
    assert.strictEqual(typeof envelope.payload, 'string')
    assert.strictEqual(fs.readFileSync(filePath, 'utf8').includes('jimaku-1'), false)

    assert.deepStrictEqual(await store.readForMainProcess(), {
      jimakuApiKey: 'jimaku-1',
      dandanplayAppSecret: 'dandan-1'
    })
    assert.deepStrictEqual(await store.status(), {
      available: true,
      configured: {
        dandanplayAppSecret: true,
        jimakuApiKey: true
      }
    })

    await store.update({ assrtApiToken: 'assrt-1' })
    const afterUpdate = await store.readForMainProcess()
    assert.strictEqual(afterUpdate.jimakuApiKey, 'jimaku-1')
    assert.strictEqual(afterUpdate.assrtApiToken, 'assrt-1')

    await store.clear(['jimakuApiKey'])
    const afterClear = await store.readForMainProcess()
    assert.strictEqual(afterClear.jimakuApiKey, undefined)
    assert.strictEqual(afterClear.dandanplayAppSecret, 'dandan-1')
    assert.strictEqual(afterClear.assrtApiToken, 'assrt-1')

    assert.strictEqual(fs.existsSync(filePath + '.tmp'), false)

    fs.writeFileSync(filePath, JSON.stringify({ version: 1, payload: Buffer.from('bad').toString('base64') }))
    await assert.rejects(() => store.readForMainProcess(), /decrypt|corrupt|secret/i)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  console.log('Secret store tests passed')
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
