const STEPS = ['step-install', 'step-progress', 'step-provider', 'step-login', 'step-done', 'step-error']

function showStep(id) {
  STEPS.forEach(s => document.getElementById(s).classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg
  showStep('step-error')
}

// ── Install ───────────────────────────────────────────────────────
document.getElementById('btn-install').addEventListener('click', async () => {
  showStep('step-progress')

  llmMuxAPI.onInstallProgress((pct) => {
    document.getElementById('progress-fill').style.width = pct + '%'
    document.getElementById('progress-label').textContent = pct + '%'
  })

  const result = await llmMuxAPI.install()
  if (!result.success) {
    showError(result.error || 'Download failed. Check your internet connection and try again.')
    return
  }
  showStep('step-provider')
})

// ── Provider selection ────────────────────────────────────────────
let selectedProvider = null

document.querySelectorAll('.provider-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'))
    card.classList.add('selected')
    selectedProvider = card.dataset.provider
    document.getElementById('btn-login').disabled = false
  })
})

document.getElementById('btn-login').addEventListener('click', async () => {
  if (!selectedProvider) return
  showStep('step-login')
  const logEl = document.getElementById('login-log')
  logEl.textContent = ''

  llmMuxAPI.onLog((line) => {
    logEl.textContent += line
    logEl.scrollTop = logEl.scrollHeight
  })

  llmMuxAPI.onLoginDone(({ success }) => {
    if (success) {
      showStep('step-done')
    } else {
      showError('Login failed or was cancelled. Please try again.')
    }
  })

  await llmMuxAPI.login(selectedProvider)
})

// ── Done ──────────────────────────────────────────────────────────
document.getElementById('btn-dashboard').addEventListener('click', () => {
  llmMuxAPI.openDashboard()
})

document.getElementById('btn-retry').addEventListener('click', () => {
  showStep('step-install')
})
