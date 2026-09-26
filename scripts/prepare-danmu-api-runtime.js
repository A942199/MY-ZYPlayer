'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const MIN_NODE_MAJOR = 18

function copyTree (from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
}

function fileSha256 (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function nodeVersion (exe) {
  try {
    const value = execFileSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true }).trim()
    const match = /^v(\d+)\./.exec(value)
    return match ? { raw: value, major: Number(match[1]) } : null
  } catch (error) {
    return null
  }
}

function nodeCandidates () {
  const candidates = []
  const add = value => {
    if (!value) return
    const resolved = path.resolve(value)
    if (!candidates.includes(resolved) && fs.existsSync(resolved)) candidates.push(resolved)
  }
  add(process.env.MY_ZYPLAYER_NODE_RUNTIME)
  if (process.platform === 'win32') {
    add(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'))
    if (process.env['ProgramFiles(x86)']) add(path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe'))
  }
  add(process.execPath)
  try {
    const where = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['node'], { encoding: 'utf8', windowsHide: true })
    where.split(/\r?\n/).filter(Boolean).forEach(add)
  } catch (error) {}
  return candidates
}

function findNodeRuntime () {
  const usable = nodeCandidates()
    .map(exe => ({ exe, version: nodeVersion(exe) }))
    .filter(row => row.version && row.version.major >= MIN_NODE_MAJOR)
    .sort((a, b) => b.version.major - a.version.major)
  if (!usable.length) throw new Error('danmu_api requires a Node.js >= ' + MIN_NODE_MAJOR + ' runtime while packaging')
  return usable[0]
}

function npmInvocationFor (nodeExecutable) {
  const npmCli = path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (fs.existsSync(npmCli)) return { executable: nodeExecutable, prefixArgs: [npmCli] }
  return { executable: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefixArgs: [] }
}

function prepareDanmuApiRuntime () {
  const root = path.resolve(__dirname, '..')
  const vendor = path.join(root, 'vendor', 'danmu-api')
  const output = path.join(root, 'build', 'danmu-api-runtime')
  const lockFile = path.join(vendor, 'package-lock.json')
  if (!fs.existsSync(lockFile)) throw new Error('Missing vendor/danmu-api/package-lock.json')

  fs.mkdirSync(output, { recursive: true })
  const lockHash = fileSha256(lockFile)
  const markerFile = path.join(output, '.deps-sha256')
  const installedHash = fs.existsSync(markerFile) ? fs.readFileSync(markerFile, 'utf8').trim() : ''
  const runtime = findNodeRuntime()

  for (const name of ['danmu_api', 'config_example']) fs.rmSync(path.join(output, name), { recursive: true, force: true })
  for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'UPSTREAM.txt']) fs.rmSync(path.join(output, name), { force: true })

  copyTree(path.join(vendor, 'danmu_api'), path.join(output, 'danmu_api'))
  copyTree(path.join(vendor, 'config'), path.join(output, 'config_example'))
  for (const name of ['package.json', 'package-lock.json', 'LICENSE', 'UPSTREAM.txt']) {
    fs.copyFileSync(path.join(vendor, name), path.join(output, name))
  }

  if (installedHash !== lockHash || !fs.existsSync(path.join(output, 'node_modules'))) {
    fs.rmSync(path.join(output, 'node_modules'), { recursive: true, force: true })
    const npm = npmInvocationFor(runtime.exe)
    execFileSync(npm.executable, [...npm.prefixArgs, 'ci', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], {
      cwd: output,
      stdio: 'inherit',
      windowsHide: true
    })
    fs.writeFileSync(markerFile, lockHash)
  }

  const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
  fs.copyFileSync(runtime.exe, path.join(output, executableName))
  if (process.platform !== 'win32') fs.chmodSync(path.join(output, executableName), 0o755)

  const nodeLicense = [path.join(path.dirname(runtime.exe), 'LICENSE'), path.join(path.dirname(runtime.exe), 'LICENSE.txt')].find(file => fs.existsSync(file))
  if (nodeLicense) fs.copyFileSync(nodeLicense, path.join(output, 'NODE-LICENSE'))

  const upstream = fs.readFileSync(path.join(vendor, 'UPSTREAM.txt'), 'utf8')
  fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({
    version: 1,
    nodeExecutable: executableName,
    nodeVersion: runtime.version.raw,
    upstream: upstream.trim()
  }, null, 2))

  console.log('Prepared local danmu_api runtime:', output, runtime.version.raw)
  return output
}

if (require.main === module) {
  try {
    prepareDanmuApiRuntime()
  } catch (error) {
    console.error(error.stack || error)
    process.exitCode = 1
  }
}

module.exports = { prepareDanmuApiRuntime }
