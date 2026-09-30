'use strict'

const MAIN_WINDOW_SECURITY_INVARIANTS = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  enableRemoteModule: false,
  webviewTag: false,
  allowRunningInsecureContent: false,
  webSecurity: true
})

function createMainWindowWebPreferences (preloadPath) {
  return {
    ...(preloadPath ? { preload: preloadPath } : {}),
    ...MAIN_WINDOW_SECURITY_INVARIANTS,
    nodeIntegrationInSubFrames: false
  }
}

module.exports = {
  MAIN_WINDOW_SECURITY_INVARIANTS,
  createMainWindowWebPreferences
}
