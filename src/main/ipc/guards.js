'use strict'

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024

function assertAppSender (event, mainWindow) {
  if (!event || !mainWindow || !mainWindow.webContents || event.sender !== mainWindow.webContents) {
    throw new Error('IPC sender is not the application window')
  }
  return true
}

function assertPlainObject (value, name = 'payload', maxBytes = DEFAULT_MAX_PAYLOAD_BYTES) {
  const proto = value && typeof value === 'object' ? Object.getPrototypeOf(value) : null
  if (!value || typeof value !== 'object' || Array.isArray(value) || (proto !== Object.prototype && proto !== null)) {
    throw new TypeError(name + ' must be a plain object')
  }

  let json
  try {
    json = JSON.stringify(value)
  } catch (error) {
    throw new TypeError(name + ' must be serializable')
  }

  const size = Buffer.byteLength(json || '', 'utf8')
  if (size > maxBytes) throw new RangeError(name + ' is too large: ' + size + ' bytes')
  return value
}

function assertHttpUrl (value, name = 'url') {
  let url
  try {
    url = new URL(String(value || ''))
  } catch (error) {
    throw new TypeError(name + ' must be a valid http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(name + ' must use http or https')
  }
  return url
}

function assertAllowedKeys (value, allowedKeys) {
  assertPlainObject(value)
  const allowed = new Set(Array.isArray(allowedKeys) ? allowedKeys : [])
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (unknown.length) throw new TypeError('Unknown key(s): ' + unknown.join(', '))
  return value
}

module.exports = {
  DEFAULT_MAX_PAYLOAD_BYTES,
  assertAllowedKeys,
  assertAppSender,
  assertHttpUrl,
  assertPlainObject
}
