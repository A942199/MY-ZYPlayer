import db from './dexie'
const { setting } = db
const { createSettingsRepository } = require('../settings/repository')

export const settingsRepository = createSettingsRepository({
  read: async () => await setting.get({ id: 0 }),
  write: async next => await setting.put({ ...next, id: 0 })
})

export default {
  async find () {
    return await setting.get({ id: 0 })
  },
  async bulkAdd (doc) {
    return await setting.bulkAdd(doc)
  },
  async add (doc) {
    return await setting.add(doc)
  },
  async update (docs) {
    return await setting.update(0, docs)
  }
}
