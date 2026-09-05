const api = window.izumiInstaller
const $ = id => document.getElementById(id)
const tvIp = $('tv-ip')
let busy = false, step = 1, verifying = false
const hide = (id, hidden) => { $(id).hidden = hidden }
function go(next) {
  step = next
  for (const [index, id] of ['connect-view', 'install-view', 'finish-view'].entries()) hide(id, next !== index + 1)
  document.querySelectorAll('[data-step]').forEach(item => {
    const number = Number(item.dataset.step)
    if (number === next) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current')
    item.classList.toggle('completed', number < next)
    item.querySelector('b').textContent = number < next ? '✓' : String(number)
  })
  $(next === 1 ? 'connect-title' : next === 2 ? 'install-title' : 'finish-title').focus()
}
function setBusy(value) {
  busy = value
  document.querySelectorAll('button:not([data-log-action])').forEach(button => { button.disabled = value && button.id !== 'verify-code' })
  tvIp.disabled = value; $('enable-updater').disabled = value
  $('connect').textContent = value && step === 1 ? 'Connecting…' : 'Connect TV →'
}
function fail(error) {
  const message = String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
  $('error-message').textContent = message; hide('error-panel', false)
  $('status').textContent = message
  $('activity').open = true
}
function validIp() {
  const ip = tvIp.value.trim(), parts = ip.split('.')
  const valid = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) && parts.every(part => Number(part) <= 255)
  tvIp.setAttribute('aria-invalid', String(!valid)); hide('ip-error', valid)
  if (!valid) { $('ip-error').textContent = 'Enter your TV’s IPv4 address, for example 192.168.1.80.'; tvIp.focus() }
  return valid
}
function phase(value) {
  const order = ['download', 'signing', 'install', 'verify'], at = order.indexOf(value.phase)
  document.querySelectorAll('[data-phase]').forEach((item, index) => { item.classList.toggle('active', index === at); item.classList.toggle('done', index < at) })
  if (step === 2) { $('install-title').textContent = value.title || 'Installing izumi'; $('install-description').textContent = value.message || 'Follow any prompts here or in your browser.' }
}
async function run(action) {
  if (busy || !validIp()) return
  hide('error-panel', true); hide('ip-error', true); hide('verify-tv', true); verifying = false
  setBusy(true); $('status').textContent = action === 'connect' ? 'Connecting to your TV…' : 'Working on your TV…'
  if (action === 'install') { hide('install-options', true); hide('operation-panel', false); $('progress').removeAttribute('value'); $('progress-label').textContent = 'Checking your TV…'; $('progress-value').textContent = ''; phase({ phase: '', title: 'Getting things ready.', message: 'We’ll check the release before making any changes.' }) }
  try {
    const result = await api.run({ action, ip: tvIp.value.trim(), enableUpdater: $('enable-updater').checked })
    if (action === 'connect') {
      $('connection-label').textContent = 'Connected · ' + tvIp.value.trim()
      $('installed-version').textContent = result.installedVersion ? 'Installed ' + result.installedVersion : 'Included'
      $('install-title').textContent = 'Install izumi.'; $('install-description').textContent = 'We’ll download the latest release and prepare it for your TV.'
      hide('install-options', false); hide('operation-panel', true); go(2)
    } else if (action === 'install') {
      hide('finish-setup', !result.updater); hide('companion-ready', Boolean(result.updater))
      $('finish-title').textContent = result.updater ? 'Finish on your TV.' : 'Your TV is ready.'
      go(3)
    }
    $('status').textContent = action === 'connect' ? 'TV connected.' : action === 'install' ? 'Installation complete.' : 'Opened on your TV.'
  } catch (error) {
    fail(error)
    if (action === 'install') { hide('operation-panel', true); hide('install-options', false); $('install-title').textContent = 'Let’s get this sorted.'; $('install-description').textContent = 'Check the message below, then retry when you’re ready.'; $('install').textContent = 'Retry installation' }
  } finally { verifying = false; hide('verify-tv', true); setBusy(false) }
}
$('connect-form').addEventListener('submit', event => { event.preventDefault(); void run('connect') })
$('install').onclick = () => { void run('install') }
$('launch').onclick = () => { void run('launch') }
$('launch-updater').onclick = () => { void run('launch-updater') }
$('back').onclick = () => { hide('error-panel', true); go(1); tvIp.focus() }
$('start-over').onclick = () => { hide('error-panel', true); tvIp.value = ''; go(1); tvIp.focus() }
document.querySelectorAll('[data-view-logs]').forEach(button => { button.onclick = () => { $('activity').open = true; $('logs-summary').focus(); $('activity').scrollIntoView({ block: 'start' }) } })
for (const [id, action, done] of [['copy-logs', 'copyLogs', 'Logs copied.'], ['save-logs', 'saveLogs', 'Logs saved.'], ['open-logs', 'openLogs', 'Saved logs opened.']]) {
  $(id).onclick = async () => {
    $(id).disabled = true; $('log-status').textContent = ''
    try { const result = await api[action](); $('log-status').textContent = result.canceled ? 'Save canceled.' : done }
    catch (error) { $('log-status').textContent = String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') }
    finally { $(id).disabled = false }
  }
}
tvIp.addEventListener('input', () => { tvIp.removeAttribute('aria-invalid'); hide('ip-error', true) })
api.onLog(entry => {
  $('copy-logs').disabled = false; $('save-logs').disabled = false
  $('log-hint').textContent = 'Recent activity is shown below. Copy or save logs for the full session, including earlier attempts.'
  const row = document.createElement('p'), time = document.createElement('time'), text = document.createElement('span')
  row.className = 'log-' + entry.type
  time.textContent = new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); text.textContent = entry.text
  row.append(time, text); $('log').append(row)
  if ($('log').children.length > 300) $('log').firstElementChild.remove()
  $('log').scrollTop = $('log').scrollHeight
})
api.onStage(phase)
api.onProgress(value => { $('progress-label').textContent = value.label; $('progress-value').textContent = typeof value.percent === 'number' ? value.percent + '%' : ''; if (value.percent === null) $('progress').removeAttribute('value'); else $('progress').value = value.percent })
api.onVerifyKey(() => {
  hide('operation-panel', true)
  verifying = true; hide('verify-tv', false); hide('code-error', true); $('tv-code').value = ''; $('verify-code').disabled = false; $('tv-code').disabled = false
  phase({ phase: 'verify', title: 'One quick check.', message: 'Confirm the code on your TV to enable future updates.' }); $('tv-code').focus()
})
$('verify-tv').addEventListener('submit', async event => {
  event.preventDefault()
  if (!verifying || $('verify-code').disabled) return
  const code = $('tv-code').value.replace(/[^a-f0-9]/gi, '')
  if (code.length !== 12) { $('code-error').textContent = 'Enter all 12 characters shown on your TV.'; hide('code-error', false); $('tv-code').focus(); return }
  $('verify-code').disabled = true; $('tv-code').disabled = true; hide('code-error', true)
  try { await api.verifyCode(code); hide('verify-tv', true); hide('operation-panel', false); $('progress-label').textContent = 'Finishing TV setup…'; $('progress-value').textContent = ''; $('progress').removeAttribute('value') } catch (error) { fail(error) }
})
api.getConfig().then(config => {
  const addresses = config.localAddresses || []
  $('host-ip').replaceChildren(...addresses.map(address => {
    const item = document.createElement('code')
    item.textContent = address
    return item
  }))
  if (!addresses.length) $('host-ip').textContent = 'Check this computer’s network settings'
  $('app-version').textContent = config.version ? 'v' + config.version : ''
}).catch(fail)
