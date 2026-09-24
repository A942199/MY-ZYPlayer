import db from './dexie'
const { sites } = db
export default {
  async all () {
    return await sites.toArray()
  },
  async clear () {
    return await sites.clear()
  },
  async bulkAdd (doc) {
    return await sites.bulkAdd(doc)
  },
  async bulkPut (doc) {
    return await sites.bulkPut(doc)
  },
  async replaceAll (doc) {
    const rows = Array.isArray(doc) ? doc : []
    return await db.transaction('rw', sites, async () => {
      await sites.clear()
      if (rows.length) await sites.bulkPut(rows)
    })
  },
  async find (doc) {
    return await sites.get(doc)
  },
  async add (doc) {
    return await sites.add(doc)
  },
  async put (doc) {
    return await sites.put(doc)
  },
  async remove (id) {
    return await sites.delete(id)
  }
}
