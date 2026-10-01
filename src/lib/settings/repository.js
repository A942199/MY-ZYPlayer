'use strict'

function isPlainObject (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function mergeSettingsPatch (current, patch) {
  const base = isPlainObject(current) ? current : {}
  if (!isPlainObject(patch)) throw new TypeError('settings patch must be a plain object')
  const next = { ...base }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (isPlainObject(value) && isPlainObject(base[key])) {
      next[key] = mergeSettingsPatch(base[key], value)
    } else if (isPlainObject(value)) {
      next[key] = mergeSettingsPatch({}, value)
    } else if (Array.isArray(value)) {
      next[key] = value.slice()
    } else {
      next[key] = value
    }
  }
  return next
}

function createSettingsRepository ({ read, write }) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new TypeError('read and write functions are required')
  }

  let queue = Promise.resolve()

  return {
    async get () {
      return await read()
    },

    updatePatch (patch) {
      const run = async () => {
        const current = await read()
        const next = mergeSettingsPatch(current || { id: 0 }, patch)
        if (next.id === undefined) next.id = 0
        await write(next)
        return next
      }
      const result = queue.then(run, run)
      queue = result.then(() => undefined, () => undefined)
      return result
    }
  }
}

module.exports = {
  createSettingsRepository,
  isPlainObject,
  mergeSettingsPatch
}
