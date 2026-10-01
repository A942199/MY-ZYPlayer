'use strict'

const { NativeHttpClient } = require('../myvideo/runtime')

function createSiteNetworkService (options = {}) {
  const client = options.client || new NativeHttpClient({
    allowPrivateNetwork: options.allowPrivateNetwork === true
  })

  return {
    async get (payload = {}) {
      const timeout = Math.min(60000, Math.max(1000, Number(payload.timeout) || 20000))
      const maxBytes = Math.min(16 * 1024 * 1024, Math.max(1024, Number(payload.maxBytes) || (12 * 1024 * 1024)))
      const response = await client.get(payload.url, { timeout, maxBytes })
      if (response.status < 200 || response.status >= 300) {
        const error = new Error('HTTP ' + response.status)
        error.status = response.status
        throw error
      }
      return response
    }
  }
}

const siteNetworkService = createSiteNetworkService({
  allowPrivateNetwork: process.env.MY_ZYPLAYER_ALLOW_PRIVATE_SOURCE_TESTS === '1'
})

module.exports = {
  createSiteNetworkService,
  siteNetworkService
}
