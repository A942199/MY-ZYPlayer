'use strict'

const { SECRET_KEYS } = require('./secret-store')

const DANMAKU_SECRET_KEYS = ['dandanplayAppSecret', 'compatibleToken']
const SUBTITLE_SECRET_KEYS = ['jimakuApiKey', 'assrtApiToken', 'openSubtitlesApiKey', 'subdlApiKey']

function cloneValue (value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, item] of Object.entries(value)) result[key] = cloneValue(item)
  return result
}

function providerSections (settings) {
  const providers = settings && settings.mediaEnhancement && settings.mediaEnhancement.providers
  return {
    danmaku: providers && providers.danmaku ? providers.danmaku : {},
    subtitles: providers && providers.subtitles ? providers.subtitles : {}
  }
}

function extractLegacySecrets (settings) {
  const sections = providerSections(settings)
  const result = {}
  for (const key of DANMAKU_SECRET_KEYS) {
    const value = sections.danmaku[key]
    if (typeof value === 'string' && value) result[key] = value
  }
  for (const key of SUBTITLE_SECRET_KEYS) {
    const value = sections.subtitles[key]
    if (typeof value === 'string' && value) result[key] = value
  }
  return result
}

function buildLegacySecretClearPatch (settings) {
  const legacy = extractLegacySecrets(settings)
  const patch = { mediaEnhancement: { providers: { danmaku: {}, subtitles: {} } } }

  for (const key of DANMAKU_SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(legacy, key)) patch.mediaEnhancement.providers.danmaku[key] = ''
  }
  for (const key of SUBTITLE_SECRET_KEYS) {
    if (Object.prototype.hasOwnProperty.call(legacy, key)) patch.mediaEnhancement.providers.subtitles[key] = ''
  }

  if (!Object.keys(patch.mediaEnhancement.providers.danmaku).length) delete patch.mediaEnhancement.providers.danmaku
  if (!Object.keys(patch.mediaEnhancement.providers.subtitles).length) delete patch.mediaEnhancement.providers.subtitles
  if (!Object.keys(patch.mediaEnhancement.providers).length) return {}
  return patch
}

function stripLegacySecrets (settings) {
  const result = cloneValue(settings || {})
  const providers = result.mediaEnhancement && result.mediaEnhancement.providers
  if (!providers) return result

  if (providers.danmaku) {
    for (const key of DANMAKU_SECRET_KEYS) {
      if (Object.prototype.hasOwnProperty.call(providers.danmaku, key)) providers.danmaku[key] = ''
    }
  }
  if (providers.subtitles) {
    for (const key of SUBTITLE_SECRET_KEYS) {
      if (Object.prototype.hasOwnProperty.call(providers.subtitles, key)) providers.subtitles[key] = ''
    }
  }
  return result
}

async function migrateLegacySecrets ({ readSettings, writeSettingsPatch, secretStore }) {
  if (typeof readSettings !== 'function' || typeof writeSettingsPatch !== 'function' || !secretStore) {
    throw new TypeError('readSettings, writeSettingsPatch and secretStore are required')
  }

  const settings = await readSettings()
  const legacy = extractLegacySecrets(settings)
  const keys = Object.keys(legacy)
  if (!keys.length) return { migrated: false, count: 0 }

  await secretStore.update(legacy)
  const verified = await secretStore.readForMainProcess()
  const mismatch = keys.find(key => verified[key] !== legacy[key])
  if (mismatch || keys.some(key => !SECRET_KEYS.includes(key))) {
    throw new Error('Secret migration verification failed')
  }

  const clearPatch = buildLegacySecretClearPatch(settings)
  await writeSettingsPatch(clearPatch)
  return { migrated: true, count: keys.length }
}

module.exports = {
  DANMAKU_SECRET_KEYS,
  SUBTITLE_SECRET_KEYS,
  buildLegacySecretClearPatch,
  extractLegacySecrets,
  migrateLegacySecrets,
  stripLegacySecrets
}
