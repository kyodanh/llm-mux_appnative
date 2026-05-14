const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const { createGunzip } = require('zlib')

const LLM_MUX_VERSION = '2.2.8'

function getInstallPath() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'llm-mux', 'llm-mux.exe')
  }
  return path.join(os.homedir(), '.local', 'bin', 'llm-mux')
}

function getConfigDir() {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'llm-mux')
  }
  return path.join(os.homedir(), '.config', 'llm-mux')
}

function detectExistingInstall() {
  const result = {
    found: false,
    binaryPath: null,
    version: null,
    hasAuth: false,
    authAccounts: [],
    configExists: false,
    isRunning: false,
    runningPort: null,
  }

  const defaultPath = getInstallPath()
  if (fs.existsSync(defaultPath)) {
    result.found = true
    result.binaryPath = defaultPath
  }

  if (!result.found) {
    try {
      const cmd = process.platform === 'win32' ? 'where llm-mux' : 'which llm-mux'
      const foundPath = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0]
      if (foundPath && fs.existsSync(foundPath)) {
        result.found = true
        result.binaryPath = foundPath
      }
    } catch {}
  }

  if (result.found) {
    try {
      const ver = execSync(`"${result.binaryPath}" version`, { encoding: 'utf8' })
      const match = ver.match(/[\d]+\.[\d]+\.[\d]+/)
      result.version = match ? match[0] : 'unknown'
    } catch {}
  }

  const authDir = path.join(getConfigDir(), 'auth')
  if (fs.existsSync(authDir)) {
    try {
      const files = fs.readdirSync(authDir).filter(f => f.endsWith('.json'))
      result.hasAuth = files.length > 0
      result.authAccounts = files.map(f => f.replace('.json', ''))
    } catch {}
  }

  const configPath = path.join(getConfigDir(), 'config.yaml')
  result.configExists = fs.existsSync(configPath)

  for (const port of [8316, 8317]) {
    try {
      const cmd = process.platform === 'win32'
        ? `netstat -ano | findstr :${port}`
        : `lsof -i :${port} -sTCP:LISTEN -t`
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
      if (out) {
        result.isRunning = true
        result.runningPort = port
        break
      }
    } catch {}
  }

  return result
}

// Returns { url, isZip } for the current platform/arch
function getDownloadInfo() {
  const platform = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? 'darwin' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64'
  const isZip = process.platform === 'win32'
  const ext = isZip ? '.zip' : '.tar.gz'
  const base = `https://github.com/nghyane/launchdock/releases/download/v${LLM_MUX_VERSION}`
  const url = `${base}/llm-mux_${LLM_MUX_VERSION}_${platform}_${arch}${ext}`
  return { url, isZip }
}

function followRedirects(url, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'llm-mux-manager' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        followRedirects(res.headers.location, onProgress).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading from ${url}`))
        return
      }
      const total = parseInt(res.headers['content-length'] || '0')
      let received = 0
      const chunks = []
      res.on('data', chunk => {
        received += chunk.length
        chunks.push(chunk)
        if (onProgress && total) onProgress(Math.round(received / total * 100))
      })
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

// Extract the llm-mux binary from a tar.gz buffer (pure Node, no tar CLI needed)
function extractTarGz(buffer, destPath) {
  return new Promise((resolve, reject) => {
    const { Gunzip } = require('zlib')
    const gunzip = new Gunzip()
    const chunks = []
    gunzip.on('data', c => chunks.push(c))
    gunzip.on('error', reject)
    gunzip.on('end', () => {
      const tar = Buffer.concat(chunks)
      // Parse tar: 512-byte blocks, find the 'llm-mux' file entry
      let offset = 0
      while (offset + 512 <= tar.length) {
        const header = tar.slice(offset, offset + 512)
        const name = header.slice(0, 100).toString('utf8').replace(/\0/g, '').trim()
        const sizeOctal = header.slice(124, 136).toString('utf8').replace(/\0/g, '').trim()
        const size = parseInt(sizeOctal, 8) || 0
        offset += 512
        if (!name) break
        // Match binary: could be llm-mux or ./llm-mux (no extension, not a dir)
        const basename = path.basename(name)
        if ((basename === 'llm-mux' || basename === 'llm-mux.exe') && size > 0) {
          const content = tar.slice(offset, offset + size)
          fs.writeFileSync(destPath, content)
          if (process.platform !== 'win32') fs.chmodSync(destPath, 0o755)
          resolve()
          return
        }
        offset += Math.ceil(size / 512) * 512
      }
      reject(new Error('llm-mux binary not found in archive'))
    })
    gunzip.write(buffer)
    gunzip.end()
  })
}

// Extract from zip buffer using system unzip (Windows guaranteed to have it from Win10)
async function extractZip(buffer, destPath) {
  const tmpZip = path.join(os.tmpdir(), `llm-mux-${Date.now()}.zip`)
  fs.writeFileSync(tmpZip, buffer)
  const tmpDir = path.join(os.tmpdir(), `llm-mux-extract-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })
  try {
    execSync(`powershell -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`)
    // Find the exe inside
    const files = fs.readdirSync(tmpDir)
    const exe = files.find(f => f === 'llm-mux.exe') || files.find(f => f.endsWith('.exe'))
    if (!exe) throw new Error('llm-mux.exe not found in zip')
    fs.copyFileSync(path.join(tmpDir, exe), destPath)
  } finally {
    try { fs.unlinkSync(tmpZip) } catch {}
    try { fs.rmSync(tmpDir, { recursive: true }) } catch {}
  }
}

async function downloadBinary(onProgress) {
  const destPath = getInstallPath()
  const destDir = path.dirname(destPath)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

  const { url, isZip } = getDownloadInfo()
  const buffer = await followRedirects(url, onProgress)

  if (isZip) {
    await extractZip(buffer, destPath)
  } else {
    await extractTarGz(buffer, destPath)
  }

  return destPath
}

module.exports = { detectExistingInstall, downloadBinary, getConfigDir, getInstallPath, LLM_MUX_VERSION }
