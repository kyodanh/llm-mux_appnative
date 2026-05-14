// ── Page navigation ───────────────────────────────────────────────
const pages = { dashboard: 'page-dashboard', accounts: 'page-accounts', logs: 'page-logs' }

document.querySelectorAll('.sidebar-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'))
    item.classList.add('active')
    Object.values(pages).forEach(p => document.getElementById(p).style.display = 'none')
    const page = item.dataset.page
    document.getElementById(pages[page]).style.display = 'block'
    if (page === 'accounts') refreshAccounts()
  })
})

// ── State ─────────────────────────────────────────────────────────
let currentStatus = 'unknown'
let detectedInfo  = null

async function init() {
  detectedInfo = await llmMuxAPI.detect()
  applyDetect(detectedInfo)

  // Subscribe to live events
  llmMuxAPI.onStatus(applyStatus)
  llmMuxAPI.onLog(appendLog)
}

function applyDetect(d) {
  if (d.version) document.getElementById('info-version').textContent = d.version
  document.getElementById('info-accounts').textContent = d.hasAuth
    ? String(d.authAccounts.length)
    : '0'
  if (d.runningPort) document.getElementById('info-port').textContent = ':' + d.runningPort
}

function applyStatus({ status, port, attached, code }) {
  currentStatus = status
  const dot   = document.getElementById('status-dot')
  const label = document.getElementById('status-label')
  const meta  = document.getElementById('status-meta')
  const stopBtn    = document.getElementById('btn-stop')
  const restartBtn = document.getElementById('btn-restart')
  const startBtn   = document.getElementById('btn-start')

  dot.className = 'status-dot ' + status

  if (status === 'running') {
    label.textContent = attached ? '● Running (attached)' : '● Running'
    const p = port || (detectedInfo && detectedInfo.runningPort) || 8316
    document.getElementById('info-port').textContent = ':' + p
    meta.textContent = `port :${p} · version ${detectedInfo?.version || '—'}`
    stopBtn.style.display    = ''
    restartBtn.style.display = ''
    startBtn.style.display   = 'none'
  } else if (status === 'stopped') {
    label.textContent = '○ Stopped'
    meta.textContent  = code != null ? `exited with code ${code}` : 'Not running'
    stopBtn.style.display    = 'none'
    restartBtn.style.display = 'none'
    startBtn.style.display   = ''
  } else if (status === 'error') {
    label.textContent = '⚠ Error'
    meta.textContent  = 'Check logs for details'
    stopBtn.style.display    = 'none'
    restartBtn.style.display = 'none'
    startBtn.style.display   = ''
  } else {
    label.textContent = 'Connecting…'
    meta.textContent  = '—'
  }
}

// ── Logging ───────────────────────────────────────────────────────
const MAX_LOG_LINES = 500
let logLines = []

function appendLog(line) {
  logLines.push(line)
  if (logLines.length > MAX_LOG_LINES) logLines.shift()
  const content = logLines.join('')
  const el1 = document.getElementById('log-body')
  const el2 = document.getElementById('log-body2')
  if (el1) { el1.textContent = content; el1.scrollTop = el1.scrollHeight }
  if (el2) { el2.textContent = content; el2.scrollTop = el2.scrollHeight }
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
  logLines = []
  document.getElementById('log-body').textContent = ''
})
document.getElementById('btn-clear-log2').addEventListener('click', () => {
  logLines = []
  document.getElementById('log-body2').textContent = ''
})

// ── Controls ──────────────────────────────────────────────────────
document.getElementById('btn-stop').addEventListener('click', async () => {
  document.getElementById('btn-stop').disabled    = true
  document.getElementById('btn-restart').disabled = true
  await llmMuxAPI.stop()
  document.getElementById('btn-stop').disabled    = false
  document.getElementById('btn-restart').disabled = false
})

document.getElementById('btn-restart').addEventListener('click', async () => {
  document.getElementById('btn-stop').disabled    = true
  document.getElementById('btn-restart').disabled = true
  await llmMuxAPI.restart()
  document.getElementById('btn-stop').disabled    = false
  document.getElementById('btn-restart').disabled = false
})

document.getElementById('btn-start').addEventListener('click', async () => {
  document.getElementById('btn-start').disabled = true
  await llmMuxAPI.start()
  document.getElementById('btn-start').disabled = false
})

// ── Accounts page ─────────────────────────────────────────────────
async function refreshAccounts() {
  const d = await llmMuxAPI.detect()
  const countEl = document.getElementById('info-accounts')
  if (countEl) countEl.textContent = d.hasAuth ? String(d.authAccounts.length) : '0'
  const list = document.getElementById('account-list')
  if (!d.hasAuth || d.authAccounts.length === 0) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px">No accounts found.</div>'
    return
  }
  list.innerHTML = d.authAccounts.map(name => `
    <div class="account-item" data-account="${name}">
      <div style="display:flex;align-items:center;gap:10px">
        <span class="account-name">${name}</span>
        <span class="account-badge">${guessProvider(name)}</span>
      </div>
      <button class="btn btn-danger btn-remove-account" data-account="${name}" style="padding:4px 12px;font-size:12px">Remove</button>
    </div>
  `).join('')

  list.querySelectorAll('.btn-remove-account').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.account
      if (!confirm(`Remove account "${name}"?\nThis deletes the saved credentials.`)) return
      btn.disabled = true
      const result = await llmMuxAPI.removeAccount(name)
      if (result.success) {
        refreshAccounts()
      } else {
        alert('Failed to remove: ' + result.error)
        btn.disabled = false
      }
    })
  })
}

function guessProvider(name) {
  if (/claude|anthropic/i.test(name)) return 'Claude'
  if (/copilot|github/i.test(name))   return 'Copilot'
  if (/gemini|google/i.test(name))    return 'Gemini'
  return 'Provider'
}

document.querySelectorAll('.provider-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.provider
    const logEl = document.getElementById('account-log')
    logEl.style.display = 'block'
    logEl.textContent = `Logging in to ${provider}…\n`

    llmMuxAPI.onLog(line => {
      logEl.textContent += line
      logEl.scrollTop = logEl.scrollHeight
    })

    llmMuxAPI.onLoginDone(({ success, provider: p }) => {
      logEl.textContent += success
        ? `\n✅ ${p} account added successfully.\n`
        : `\n❌ Login failed or cancelled.\n`
      refreshAccounts()
    })

    await llmMuxAPI.login(provider)
  })
})

// ── Request log toggle ────────────────────────────────────────────
async function initRequestLogBtn() {
  const btn   = document.getElementById('btn-toggle-reqlog')
  const badge = document.getElementById('log-mode-badge')

  const { enabled } = await llmMuxAPI.getRequestLog()
  updateReqLogUI(enabled)

  btn.addEventListener('click', async () => {
    btn.disabled = true
    const result = await llmMuxAPI.toggleRequestLog()
    if (result.success) {
      updateReqLogUI(result.enabled)
      appendLog(`[system] logging ${result.enabled ? 'enabled' : 'disabled'} — click Restart to apply.\n`)
    }
    btn.disabled = false
  })

  function updateReqLogUI(enabled) {
    if (enabled) {
      badge.textContent = 'all requests'
      badge.style.background = 'rgba(34,197,94,0.15)'
      badge.style.color       = '#22c55e'
      badge.style.border      = '1px solid rgba(34,197,94,0.3)'
      btn.textContent = 'Disable full logging'
    } else {
      badge.textContent = 'errors only'
      badge.style.background = 'rgba(245,158,11,0.15)'
      badge.style.color       = '#f59e0b'
      badge.style.border      = '1px solid rgba(245,158,11,0.3)'
      btn.textContent = 'Enable full logging'
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────
init()
initRequestLogBtn()
