const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('llmMuxAPI', {
  detect:            ()  => ipcRenderer.invoke('get-detect'),
  install:           ()  => ipcRenderer.invoke('install-llmmux'),
  login:             (p) => ipcRenderer.invoke('login', p),
  start:             ()  => ipcRenderer.invoke('start'),
  stop:              ()  => ipcRenderer.invoke('stop'),
  restart:           ()  => ipcRenderer.invoke('restart'),
  getStatus:         ()  => ipcRenderer.invoke('get-status'),
  openDashboard:     ()  => ipcRenderer.invoke('open-dashboard'),
  toggleRequestLog:  ()  => ipcRenderer.invoke('toggle-request-log'),
  getRequestLog:     ()  => ipcRenderer.invoke('get-request-log'),
  onStatus:          (cb) => ipcRenderer.on('llmmux-status',    (_, d) => cb(d)),
  onLog:             (cb) => ipcRenderer.on('llmmux-log',       (_, d) => cb(d)),
  onInstallProgress: (cb) => ipcRenderer.on('install-progress', (_, pct) => cb(pct)),
  removeAccount:     (name) => ipcRenderer.invoke('remove-account', name),
  onLoginDone:       (cb) => ipcRenderer.on('login-done',       (_, d) => cb(d)),
})
