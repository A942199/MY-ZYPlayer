'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const files = [
  'src/App.vue',
  'src/components/Frame.vue',
  'src/components/Detail.vue',
  'src/components/Film.vue',
  'src/components/History.vue',
  'src/components/Star.vue',
  'src/components/Setting.vue',
  'src/components/Play.vue',
  'src/components/Douban.vue',
  'src/lib/site/tools.js',
  'src/lib/site/myvideo.js',
  'src/lib/douban/scanner.js'
]

const forbidden = [
  /require\(['"]electron['"]\)/,
  /from ['"]electron['"]/,
  /@electron\/remote/,
  /\bipcRenderer\b/
]

const violations = []
for (const file of files) {
  const text = fs.readFileSync(path.resolve(file), 'utf8')
  forbidden.forEach(pattern => {
    if (pattern.test(text)) violations.push(file + ': ' + pattern)
  })
}

assert.deepStrictEqual(violations, [])
console.log('Renderer Electron boundary tests passed')
