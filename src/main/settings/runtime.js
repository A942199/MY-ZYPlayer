'use strict'

const path = require('path')
const { createSecretStore } = require('./secret-store')
const { migrateLegacySecrets } = require('./secret-migration')

function createSettingsSecretRuntime ({ safeStorage, fs, userDataPath }) {
  const secretStore = createSecretStore({
    safeStorage,
    fs,
    filePath: path.join(userDataPath, 'provider-secrets.json')
  })

  return {
    secretStatus: () => secretStore.status(),
    updateSecrets: patch => secretStore.update(patch),
    clearSecrets: keys => secretStore.clear(keys),
    readForMainProcess: () => secretStore.readForMainProcess(),

    async migrateLegacy (settings) {
      let clearPatch = {}
      const result = await migrateLegacySecrets({
        readSettings: async () => settings || {},
        writeSettingsPatch: async patch => { clearPatch = patch },
        secretStore
      })
      return {
        ...result,
        clearPatch,
        status: await secretStore.status()
      }
    }
  }
}

module.exports = {
  createSettingsSecretRuntime
}
