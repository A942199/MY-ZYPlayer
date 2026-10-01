'use strict'

const path = require('path')

const SECRET_KEYS = Object.freeze([
  'dandanplayAppSecret',
  'compatibleToken',
  'jimakuApiKey',
  'assrtApiToken',
  'openSubtitlesApiKey',
  'subdlApiKey'
])

function assertSafeStorage (safeStorage) {
  if (!safeStorage ||
      typeof safeStorage.isEncryptionAvailable !== 'function' ||
      !safeStorage.isEncryptionAvailable() ||
      typeof safeStorage.encryptString !== 'function' ||
      typeof safeStorage.decryptString !== 'function') {
    throw new Error('OS safe storage is unavailable')
  }
}

function sanitizeSecrets (value) {
  const result = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of SECRET_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const secret = value[key]
    if (secret === undefined || secret === null) continue
    if (typeof secret !== 'string') throw new TypeError(key + ' must be a string')
    if (secret) result[key] = secret
  }
  return result
}

function createSecretStore ({ safeStorage, fs, filePath }) {
  if (!fs || typeof fs.readFileSync !== 'function') throw new TypeError('fs is required')
  if (!filePath) throw new TypeError('filePath is required')

  function available () {
    try {
      return Boolean(
        safeStorage &&
        typeof safeStorage.isEncryptionAvailable === 'function' &&
        safeStorage.isEncryptionAvailable() &&
        typeof safeStorage.encryptString === 'function' &&
        typeof safeStorage.decryptString === 'function'
      )
    } catch (error) {
      return false
    }
  }

  function readEnvelope () {
    if (!fs.existsSync(filePath)) return {}
    let envelope
    try {
      envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      throw new Error('Secret storage is corrupt: invalid envelope')
    }
    if (!envelope || envelope.version !== 1 || typeof envelope.payload !== 'string') {
      throw new Error('Secret storage is corrupt: unsupported envelope')
    }

    assertSafeStorage(safeStorage)
    try {
      const encrypted = Buffer.from(envelope.payload, 'base64')
      const plaintext = safeStorage.decryptString(encrypted)
      return sanitizeSecrets(JSON.parse(plaintext))
    } catch (error) {
      throw new Error('Secret storage decrypt failed')
    }
  }

  function writeSecrets (secrets) {
    assertSafeStorage(safeStorage)
    const sanitized = sanitizeSecrets(secrets)
    const encrypted = safeStorage.encryptString(JSON.stringify(sanitized))
    if (!Buffer.isBuffer(encrypted)) throw new Error('Secret storage encryption returned invalid data')

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tempPath = filePath + '.tmp'
    const envelope = JSON.stringify({
      version: 1,
      payload: encrypted.toString('base64')
    })
    try {
      fs.writeFileSync(tempPath, envelope, { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(tempPath, filePath)
    } finally {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath) } catch (error) {}
      }
    }
  }

  return {
    async status () {
      if (!available()) return { available: false, configured: {} }
      const secrets = readEnvelope()
      const configured = {}
      for (const key of SECRET_KEYS) {
        if (secrets[key]) configured[key] = true
      }
      return { available: true, configured }
    },

    async update (patch) {
      assertSafeStorage(safeStorage)
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new TypeError('secret patch must be an object')
      }
      const unknown = Object.keys(patch).filter(key => !SECRET_KEYS.includes(key))
      if (unknown.length) throw new TypeError('Unknown secret key(s): ' + unknown.join(', '))
      const current = readEnvelope()
      const next = { ...current }
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue
        if (typeof value !== 'string') throw new TypeError(key + ' must be a string')
        if (value) next[key] = value
        else delete next[key]
      }
      writeSecrets(next)
      return await this.status()
    },

    async clear (keys) {
      assertSafeStorage(safeStorage)
      if (!Array.isArray(keys)) throw new TypeError('keys must be an array')
      const unknown = keys.filter(key => !SECRET_KEYS.includes(key))
      if (unknown.length) throw new TypeError('Unknown secret key(s): ' + unknown.join(', '))
      const current = readEnvelope()
      for (const key of keys) delete current[key]
      writeSecrets(current)
      return await this.status()
    },

    async readForMainProcess () {
      assertSafeStorage(safeStorage)
      return readEnvelope()
    }
  }
}

module.exports = {
  SECRET_KEYS,
  createSecretStore,
  sanitizeSecrets
}
