'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const files = [
  'src/App.vue',
  'src/components/EditSites.vue',
  'src/components/Film.vue',
  'src/components/History.vue',
  'src/components/Play.vue',
  'src/components/Setting.vue',
  'src/components/Star.vue',
  'src/lib/site/tools.js'
]

const violations = []
for (const file of files) {
  const text = fs.readFileSync(path.resolve(file), 'utf8')
  if (/\bsetting\.update\s*\(/.test(text)) violations.push(file)
}
assert.deepStrictEqual(violations, [])
console.log('Settings callsite boundary tests passed')
