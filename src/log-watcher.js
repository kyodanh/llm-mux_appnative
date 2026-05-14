const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { getConfigDir } = require('./installer')

class LogWatcher extends EventEmitter {
  constructor() {
    super()
    this._watcher = null
    this._seen = new Set()
    this._logsDir = path.join(getConfigDir(), 'logs')
  }

  start() {
    if (!fs.existsSync(this._logsDir)) {
      try { fs.mkdirSync(this._logsDir, { recursive: true }) } catch {}
    }

    // Replay last 5 log files on startup
    this._replayRecent(5)

    // Watch directory for new files
    try {
      this._watcher = fs.watch(this._logsDir, (event, filename) => {
        if (!filename || !filename.endsWith('.log')) return
        const fullPath = path.join(this._logsDir, filename)
        if (!this._seen.has(fullPath)) {
          this._seen.add(fullPath)
          // Small delay so the file is fully written before reading
          setTimeout(() => this._emitLogFile(fullPath), 200)
        }
      })
      this._watcher.on('error', () => {})
    } catch {}
  }

  stop() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  }

  _replayRecent(n) {
    try {
      const files = fs.readdirSync(this._logsDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ name: f, full: path.join(this._logsDir, f) }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(-n)

      for (const { full } of files) {
        this._seen.add(full)
        this._emitLogFile(full)
      }
    } catch {}
  }

  _emitLogFile(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8')
      const line = this._formatLogFile(path.basename(filePath), raw)
      this.emit('line', line)
    } catch {}
  }

  // Parse the structured log files llm-mux writes and produce a compact one-liner
  _formatLogFile(filename, content) {
    // Extract timestamp from filename: error-v1-chat-completions-2026-04-22T112910-676086000.log
    const tsMatch = filename.match(/(\d{4}-\d{2}-\d{2}T\d{6})/)
    let ts = tsMatch ? tsMatch[1].replace('T', ' ').replace(/(\d{2})(\d{2})(\d{2})$/, '$1:$2:$3') : '?'

    // Extract method + URL from content
    const urlMatch    = content.match(/^URL:\s*(.+)$/m)
    const methodMatch = content.match(/^Method:\s*(.+)$/m)
    // Extract status code from response section
    const statusMatch = content.match(/^Status(?:\s+Code)?:\s*(\d+)/m)

    const method = methodMatch ? methodMatch[1].trim() : 'POST'
    const url    = urlMatch    ? urlMatch[1].trim()    : '/v1/chat/completions'
    const status = statusMatch ? statusMatch[1]        : 'ERR'

    const statusIcon = status === 'ERR' ? '❌' : (parseInt(status) < 400 ? '✅' : '⚠️')
    return `[${ts}] ${statusIcon} ${method} ${url} ${status !== 'ERR' ? status : ''}\n`
  }
}

module.exports = new LogWatcher()
