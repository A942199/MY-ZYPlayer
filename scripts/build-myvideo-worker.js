'use strict'

const fs = require('fs')
const path = require('path')
const webpack = require('webpack')

function buildMyVideoWorker () {
  const root = path.resolve(__dirname, '..')
  const outputPath = path.join(root, 'build', 'myvideo')
  fs.mkdirSync(outputPath, { recursive: true })

  return new Promise((resolve, reject) => {
    webpack({
      mode: 'production',
      target: 'node14',
      entry: path.join(root, 'src', 'main', 'myvideo', 'runtime.worker.js'),
      output: {
        path: outputPath,
        filename: 'runtime.worker.js'
      },
      optimization: {
        minimize: false
      },
      externalsPresets: {
        node: true
      }
    }, (error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) {
        return reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true })))
      }
      const file = path.join(outputPath, 'runtime.worker.js')
      if (!fs.existsSync(file)) return reject(new Error('Bundled MyVideo worker was not generated'))
      console.log('Bundled MyVideo worker:', file)
      resolve(file)
    })
  })
}

if (require.main === module) {
  buildMyVideoWorker().catch(error => {
    console.error(error.stack || error)
    process.exitCode = 1
  })
}

module.exports = { buildMyVideoWorker }
