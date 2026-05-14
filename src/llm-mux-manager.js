const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const http = require('http')
const { detectExistingInstall, getInstallPath } = require('./installer')

class LlmMuxManager extends EventEmitter {
  constructor() {
    super()
    this.process = null
    this.port = 8316
    this.status = 'unknown'
    this._healthTimer = null
  }

  async start() {
    const detected = detectExistingInstall()

    if (detected.isRunning) {
      this.port = detected.runningPort
      this.status = 'running'
      this.emit('status', { status: 'running', port: this.port, attached: true })
      this._startHealthCheck()
      return { attached: true, port: this.port }
    }

    const binaryPath = detected.binaryPath || getInstallPath()
    this.process = spawn(binaryPath, ['serve', '-p', String(this.port)], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.process.stdout.on('data', d => this.emit('log', d.toString()))
    this.process.stderr.on('data', d => this.emit('log', d.toString()))
    this.process.on('exit', (code) => {
      this.process = null
      this.status = 'stopped'
      this.emit('status', { status: 'stopped', code })
    })
    this.process.on('error', (err) => {
      this.status = 'error'
      this.emit('status', { status: 'error', message: err.message })
    })

    const ready = await this._waitReady()
    if (ready) this._startHealthCheck()
    return { attached: false, port: this.port }
  }

  stop() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer)
      this._healthTimer = null
    }
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.status = 'stopped'
    this.emit('status', { status: 'stopped' })
  }

  async restart() {
    this.stop()
    await new Promise(r => setTimeout(r, 1200))
    return this.start()
  }

  async _waitReady(timeout = 10000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (await this._ping()) {
        this.status = 'running'
        this.emit('status', { status: 'running', port: this.port })
        return true
      }
      await new Promise(r => setTimeout(r, 500))
    }
    this.status = 'error'
    this.emit('status', { status: 'error', message: 'Timeout waiting for llm-mux to be ready' })
    return false
  }

  _ping() {
    return new Promise(resolve => {
      const req = http.get(`http://localhost:${this.port}/`, { timeout: 2000 }, res => {
        res.resume()
        resolve(res.statusCode < 500)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
  }

  _startHealthCheck() {
    if (this._healthTimer) clearInterval(this._healthTimer)
    this._healthTimer = setInterval(async () => {
      const alive = await this._ping()
      const newStatus = alive ? 'running' : 'stopped'
      if (newStatus !== this.status) {
        this.status = newStatus
        this.emit('status', { status: newStatus })
      }
    }, 15000)
  }
}

module.exports = new LlmMuxManager()
