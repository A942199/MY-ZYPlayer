import db from './dexie'
const { sites } = db
let mutationRevision = 0

function markMutated (value) {
  mutationRevision++
  return value
}

export default {
  revision () {
    return mutationRevision
  },
  async all () {
    return await sites.toArray()
  },
  async clear () {
    return markMutated(await sites.clear())
  },
  async bulkAdd (doc) {
    return markMutated(await sites.bulkAdd(doc))
  },
  async bulkPut (doc) {
    return markMutated(await sites.bulkPut(doc))
  },
  async replaceAll (doc) {
    const rows = Array.isArray(doc) ? doc : []
    const result = await db.transaction('rw', sites, async () => {
      await sites.clear()
      if (rows.length) await sites.bulkPut(rows)
    })
    return markMutated(result)
  },
  async find (doc) {
    return await sites.get(doc)
  },
  async add (doc) {
    return markMutated(await sites.add(doc))
  },
  async put (doc) {
    return markMutated(await sites.put(doc))
  },
  async remove (id) {
    return markMutated(await sites.delete(id))
  }
}
