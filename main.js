const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const { spawn } = require('child_process')
const { detectExistingInstall, downloadBinary, getInstallPath } = require('./src/installer')
const llmMux    = require('./src/llm-mux-manager')
const logWatcher = require('./src/log-watcher')

let mainWindow

function createWindow(page = 'index.html') {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 760,
    minHeight: 480,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'renderer', page))
}

app.whenReady().then(async () => {
  const detected = detectExistingInstall()

  if (!detected.found) {
    createWindow('setup.html')
    return
  }

  createWindow('index.html')
  wireManagerEvents()
  await llmMux.start()
})

app.on('window-all-closed', () => {
  logWatcher.stop()
  llmMux.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const detected = detectExistingInstall()
    createWindow(detected.found ? 'index.html' : 'setup.html')
  }
})

function wireManagerEvents() {
  llmMux.on('status', s => mainWindow?.webContents.send('llmmux-status', s))
  llmMux.on('log',    l => mainWindow?.webContents.send('llmmux-log', l))

  // Log watcher covers the "attached" case — watches llm-mux error log files
  logWatcher.removeAllListeners('line')
  logWatcher.on('line', l => mainWindow?.webContents.send('llmmux-log', l))
  logWatcher.start()
}

// ── IPC ────────────────────────────────────────────────────────────

ipcMain.handle('get-detect', () => detectExistingInstall())

ipcMain.handle('install-llmmux', async (event) => {
  try {
    await downloadBinary((pct) => event.sender.send('install-progress', pct))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('login', async (_, provider) => {
  const binaryPath = getInstallPath()
  const proc = spawn(binaryPath, ['login', provider], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Stream login output back to renderer so user sees the auth URL
  proc.stdout.on('data', d => mainWindow?.webContents.send('llmmux-log', d.toString()))
  proc.stderr.on('data', d => mainWindow?.webContents.send('llmmux-log', d.toString()))

  return new Promise(resolve => {
    proc.on('exit', code => {
      mainWindow?.webContents.send('login-done', { provider, success: code === 0 })
      resolve({ success: code === 0 })
    })
    proc.on('error', err => resolve({ success: false, error: err.message }))
  })
})

ipcMain.handle('start',   () => llmMux.start())
ipcMain.handle('stop',    () => llmMux.stop())
ipcMain.handle('restart', () => llmMux.restart())
ipcMain.handle('get-status', () => ({ status: llmMux.status, port: llmMux.port }))

ipcMain.handle('toggle-request-log', async () => {
  const yaml  = require('js-yaml')
  const { getConfigDir } = require('./src/installer')
  const configPath = path.join(getConfigDir(), 'config.yaml')
  try {
    const raw    = fs.readFileSync(configPath, 'utf8')
    const config = yaml.load(raw)
    config['request-log'] = !config['request-log']
    config['logging-to-file'] = config['request-log']
    fs.writeFileSync(configPath, yaml.dump(config))
    return { success: true, enabled: config['request-log'] }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('remove-account', async (_, accountName) => {
  const { getConfigDir } = require('./src/installer')
  const authPath = path.join(getConfigDir(), 'auth', accountName + '.json')
  try {
    if (!fs.existsSync(authPath)) return { success: false, error: 'Account not found' }
    fs.unlinkSync(authPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('get-request-log', () => {
  const yaml  = require('js-yaml')
  const { getConfigDir } = require('./src/installer')
  const configPath = path.join(getConfigDir(), 'config.yaml')
  try {
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'))
    return { enabled: !!config['request-log'] }
  } catch { return { enabled: false } }
})

ipcMain.handle('open-dashboard', () => {
  // After setup completes, reload into dashboard without restarting app
  wireManagerEvents()
  mainWindow?.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  llmMux.start()
})
