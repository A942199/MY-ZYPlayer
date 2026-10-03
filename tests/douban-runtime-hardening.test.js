'use strict'

const assert = require('assert')
const http = require('http')

async function main () {
  let listRequests = 0
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/j/search_subjects') {
      listRequests++
      if (listRequests === 1) {
        res.writeHead(503, { 'Content-Type': 'text/plain' })
        res.end('temporary')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ subjects: [{ id: '1', title: '重试成功', rate: '9.0' }] }))
      return
    }
    if (url.pathname === '/search') {
      const html = [
        '<div class="result"><h3><a href="https://movie.douban.com/subject/1001/">The Ring</a></h3><span class="subject-cast">Gore Verbinski / Naomi Watts / 美国 / 英语 / 2002</span></div>',
        '<div class="result"><h3><a href="https://movie.douban.com/subject/1002/">リング</a></h3><span class="subject-cast">中田秀夫 / 松嶋菜々子 / 日本 / 日语 / 1998</span></div>'
      ].join('')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (url.pathname === '/subject/1002/') {
      const html = [
        '<span property="v:itemreviewed">リング</span>',
        '<span class="year">(1998)</span>',
        '<div id="info">制片国家/地区: 日本\n语言: 日语\n片长: 96分钟\n上映日期: 1998-01-31</div>',
        '<strong property="v:average">7.6</strong>'
      ].join('')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  process.env.MY_ZYPLAYER_DOUBAN_MOVIE_ORIGIN = origin
  process.env.MY_ZYPLAYER_DOUBAN_SEARCH_ORIGIN = origin

  try {
    const runtime = require('../src/main/douban/runtime')
    const list = await runtime.listSubjects({ kind: 'movie', tag: '日本', limit: 1 })
    assert.strictEqual(listRequests, 2, 'Transient HTTP 5xx responses should be retried')
    assert.strictEqual(list.list[0].title, '重试成功')

    const search = await runtime.searchSubjects({ text: 'リング', japanOnly: true })
    assert.deepStrictEqual(search.list.map(item => item.id), ['1002'], 'Japanese query text must not bypass Japan-only result filtering')

    const detail = await runtime.subjectDetail(search.list[0], { subjectFingerprint: async () => null })
    assert.strictEqual(detail.kind, 'movie', 'Movie detail markers should resolve unknown search result kind to movie')
  } finally {
    await new Promise(resolve => server.close(resolve))
  }

  console.log('Douban runtime hardening tests passed')
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
