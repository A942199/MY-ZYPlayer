'use strict'

const assert = require('assert')
const { listSubjects, subjectDetail } = require('../src/main/douban/runtime')

async function main () {
  const movies = await listSubjects({ kind: 'movie', tag: '热门', limit: 5 })
  assert(Array.isArray(movies.list) && movies.list.length > 0)
  assert(movies.list[0].id)
  assert(movies.list[0].title)
  const detail = await subjectDetail(movies.list[0])
  assert.strictEqual(detail.id, movies.list[0].id)
  assert(detail.title)
  assert(detail.year)
  assert(detail.url.includes('/subject/'))
  console.log('Douban live integration passed:', detail.title, detail.year || '')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
