'use strict'

const dns = require('dns')
const net = require('net')

function ipv4Number (address) {
  const parts = String(address).split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function inIpv4Range (value, base, maskBits) {
  const shift = 32 - maskBits
  return (value >>> shift) === (base >>> shift)
}

function isBlockedIpv4 (address) {
  const value = ipv4Number(address)
  if (value == null) return true
  const ranges = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ]
  return ranges.some(([base, bits]) => inIpv4Range(value, ipv4Number(base), bits))
}

function isBlockedIpv6 (address) {
  const normalized = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]
  if (!normalized || normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith('ff')) return true
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isBlockedIpv4(mapped[1])
  return false
}

function isBlockedAddress (address) {
  const raw = String(address || '').replace(/^\[|\]$/g, '')
  const family = net.isIP(raw)
  if (family === 4) return isBlockedIpv4(raw)
  if (family === 6) return isBlockedIpv6(raw)
  return true
}

async function defaultLookup (hostname) {
  return await dns.promises.lookup(hostname, { all: true, verbatim: true })
}

async function assertPublicHttpTarget (rawUrl, { lookup = defaultLookup, allowPrivateNetwork = false } = {}) {
  let url
  try {
    url = new URL(String(rawUrl || ''))
  } catch (error) {
    throw new TypeError('Target must be a valid http(s) URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Target must use http or https')
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname) throw new TypeError('Target hostname is required')
  if (allowPrivateNetwork) return url
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Blocked private or loopback target')
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) throw new Error('Blocked private, link-local, or reserved target')
    return url
  }

  const resolved = await lookup(hostname)
  const rows = Array.isArray(resolved) ? resolved : [resolved]
  if (!rows.length) throw new Error('Target hostname resolved to no addresses')
  for (const row of rows) {
    const address = typeof row === 'string' ? row : row && row.address
    if (!address || isBlockedAddress(address)) {
      throw new Error('Blocked private, link-local, or reserved target')
    }
  }
  return url
}

module.exports = {
  assertPublicHttpTarget,
  isBlockedAddress
}
