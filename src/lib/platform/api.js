'use strict'

function getPlatformApi () {
  if (typeof window === 'undefined' || !window.myzy) {
    throw new Error('Electron preload bridge is unavailable')
  }
  return window.myzy
}

module.exports = { getPlatformApi }
