'use strict'

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')
const { spawn } = require('child_process')

const START_TIMEOUT_MS = 15000
const LOCAL_SOURCE_ORDER = process.env.MY_ZYPLAYER_DANMU_SOURCE_ORDER || 'bilibili,tencent,360,douban,renren'

let child = null
let startPromise = null
let baseUrl = ''
let lastExit = null
const logTail = []

function rememberLog (stream, chunk) {
  String(chunk || '').split(/\r?\n/).filter(Boolean).forEach(line => {
    logTail.push({ stream, line: line.slice(0, 800), at: Date.now() })
  })
  if (logTail.length > 80) logTail.splice(0, logTail.length - 80)
}

function runtimeRoot () {
  if (process.env.MY_ZYPLAYER_DANMU_RUNTIME) return path.resolve(process.env.MY_ZYPLAYER_DANMU_RUNTIME)
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'danmu-api')
  if (packaged && fs.existsSync(path.join(packaged, 'runtime.json'))) return packaged
  return path.resolve(process.cwd(), 'build', 'danmu-api-runtime')
}

function userDataRoot () {
  if (process.env.MY_ZYPLAYER_DANMU_DATA) return path.resolve(process.env.MY_ZYPLAYER_DANMU_DATA)
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'danmu-api')
}

function freePort () {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close(error => error ? reject(error) : resolve(port))
    })
  })
}

function probe (url) {
  return new Promise(resolve => {
    const req = http.get(url, { timeout: 800 }, response => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
  })
}

async function waitUntilReady (url, proc) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!proc || proc.exitCode != null) throw new Error('local_danmu_api_exited')
    if (await probe(url)) return
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  throw new Error('local_danmu_api_start_timeout')
}

function runtimeFiles () {
  const root = runtimeRoot()
  let manifest = {}
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'), 'utf8'))
  } catch (error) {
    throw new Error('local_danmu_api_runtime_missing')
  }
  const nodeExecutable = path.join(root, manifest.nodeExecutable || (process.platform === 'win32' ? 'node.exe' : 'node'))
  const serverScript = path.join(root, 'danmu_api', 'server.js')
  if (!fs.existsSync(nodeExecutable) || !fs.existsSync(serverScript)) throw new Error('local_danmu_api_runtime_incomplete')
  return { root, nodeExecutable, serverScript, manifest }
}

async function startLocalDanmuApi () {
  if (child && child.exitCode == null && baseUrl) return baseUrl
  if (startPromise) return startPromise

  startPromise = (async () => {
    const runtime = runtimeFiles()
    const dataRoot = userDataRoot()
    const configDir = path.join(dataRoot, 'config')
    fs.mkdirSync(configDir, { recursive: true })

    const mainPort = await freePort()
    let proxyPort = await freePort()
    while (proxyPort === mainPort) proxyPort = await freePort()
    const token = crypto.randomBytes(24).toString('hex')
    const localBaseUrl = 'http://127.0.0.1:' + mainPort + '/' + token

    const env = {
      ...process.env,
      TOKEN: token,
      DANMU_API_PORT: String(mainPort),
      DANMU_API_PROXY_PORT: String(proxyPort),
      DANMU_API_HOST: '127.0.0.1',
      DANMU_API_PUBLIC_PROTO: 'http',
      DANMU_API_CONFIG_DIR: configDir,
      DANMU_API_DISABLE_FAVORITE_SCHEDULER: '1',
      DANMU_OUTPUT_FORMAT: 'json',
      SOURCE_ORDER: LOCAL_SOURCE_ORDER,
      OTHER_SERVER: '',
      CUSTOM_SOURCE_API_URL: '',
      RATE_LIMIT_MAX_REQUESTS: '0',
      USE_BANGUMI_DATA: 'false',
      STRICT_TITLE_MATCH: 'false',
      ENABLE_ANIME_EPISODE_FILTER: 'false',
      DANMU_LIMIT: '0',
      REMEMBER_LAST_SELECT: 'false'
    }

    const proc = spawn(runtime.nodeExecutable, [runtime.serverScript], {
      cwd: dataRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child = proc
    lastExit = null
    if (proc.stdout) proc.stdout.on('data', chunk => rememberLog('stdout', chunk))
    if (proc.stderr) proc.stderr.on('data', chunk => rememberLog('stderr', chunk))
    proc.on('exit', (code, signal) => {
      lastExit = { code, signal, at: Date.now() }
      if (child === proc) {
        child = null
        baseUrl = ''
      }
    })

    try {
      await waitUntilReady(localBaseUrl, proc)
      baseUrl = localBaseUrl
      return baseUrl
    } catch (error) {
      try { proc.kill() } catch (killError) {}
      if (child === proc) child = null
      baseUrl = ''
      throw error
    }
  })()

  try {
    return await startPromise
  } finally {
    startPromise = null
  }
}

function stopLocalDanmuApi () {
  const proc = child
  child = null
  baseUrl = ''
  startPromise = null
  if (!proc || proc.exitCode != null) return
  try { proc.kill() } catch (error) {}
}

function readLocalDanmuAnimeCache () {
  const file = path.join(userDataRoot(), '.cache', 'animes')
  try {
    let data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof data === 'string') data = JSON.parse(data)
    if (!Array.isArray(data)) return { animes: [] }
    return {
      animes: data.slice(0, 1000).map(anime => ({
        animeId: anime && anime.animeId,
        animeTitle: anime && anime.animeTitle,
        type: anime && anime.type,
        episodes: (Array.isArray(anime && anime.links) ? anime.links : []).slice(0, 10000).map(link => ({
          episodeId: link && link.id,
          episodeTitle: link && (link.title || link.name),
          url: link && link.url
        }))
      }))
    }
  } catch (error) {
    return { animes: [] }
  }
}

function localDanmuApiDiagnostics () {
  return {
    running: Boolean(child && child.exitCode == null && baseUrl),
    baseUrl: baseUrl ? baseUrl.replace(/\/[^/]+$/, '/[token]') : '',
    pid: child && child.exitCode == null ? child.pid : null,
    lastExit,
    logTail: logTail.slice(-30)
  }
}

module.exports = {
  LOCAL_SOURCE_ORDER,
  startLocalDanmuApi,
  stopLocalDanmuApi,
  readLocalDanmuAnimeCache,
  localDanmuApiDiagnostics
}
