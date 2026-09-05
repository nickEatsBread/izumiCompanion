// Synthetic documentation addresses; no maintainer network data.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const output = process.env.IZUMI_UI_OUTPUT || path.resolve(__dirname, '../dist/ui-review')
fs.mkdirSync(output, { recursive: true })
app.disableHardwareAcceleration(); app.setPath('userData', path.join(output, 'profile'))
let finishInstall, failConnect = false, failInstall = false, verificationCount = 0
const calls = [], screenshots = []
const logEntries = [], logActions = []
let copiedLogs = '', cancelSave = true
let cloudflareOpened = 0
ipcMain.handle('installer:cloudflare-setup', () => { cloudflareOpened++; return { ok: true } })
const localAddresses = ['192.0.2.20', '198.51.100.10', '198.51.100.11', '198.51.100.12', '203.0.113.10', '255.255.255.254', '198.51.100.200']
ipcMain.handle('installer:get-config', () => ({ localAddresses, version: '0.2.36' }))
ipcMain.handle('installer:copy-logs', () => { copiedLogs = logEntries.map(entry => entry.text).join('\n'); logActions.push('copy'); return { ok: true } })
ipcMain.handle('installer:save-logs', () => { logActions.push('save'); return cancelSave ? { canceled: true } : { ok: true } })
ipcMain.handle('installer:open-logs', () => { logActions.push('open'); return { ok: true } })
ipcMain.handle('installer:run', async (event, request) => {
  calls.push(request.action)
  const log = (type, text) => { const entry = { type, text, at: Date.now() }; logEntries.push(entry); event.sender.send('installer:log', entry) }
  log('info', request.action + ' started.')
  if (request.action === 'connect') { if (failConnect) throw Error('Could not connect. Restart your TV and try again.'); return { installedVersion: '0.2.35' } }
  if (request.action !== 'install') return { ok: true }
  if (failInstall) { log('command', 'TV · 0 vd_appinstall IzumiTV001 /tmp/izumi.wgt'); log('output', 'Installing package…\ninstall failed [118012]\nSamsung certificate rejected'); log('error', 'Samsung rejected the package: install failed [118012].'); throw Error('Samsung rejected the package: install failed [118012].') }
  if (!request.enableUpdater) return { ok: true, updater: false }
  event.sender.send('installer:stage', { phase: 'download', title: 'Downloading izumi.', message: 'Version 0.2.36 is on its way.' })
  event.sender.send('installer:progress', { label: 'Downloading izumi Companion', percent: 38 })
  return new Promise(resolve => { finishInstall = () => resolve({ ok: true, updater: true }) })
})
ipcMain.handle('installer:verify-code', (_event, code) => { assert.equal(code, 'ABCD1234EF56'); verificationCount++; finishInstall() })
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1120, height: 840, webPreferences: { preload: path.resolve(__dirname, '../src/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
  const js = code => win.webContents.executeJavaScript(code)
  async function waitFor(code) { for (let i = 0; i < 100; i++) { if (await js(code)) return; await new Promise(r => setTimeout(r, 30)) } throw Error('UI did not reach expected state: ' + code) }
  async function capture(name) {
    await win.webContents.capturePage()
    await new Promise(r => setTimeout(r, 250))
    const state = await js(`({overflow:document.body.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>({text:b.textContent.trim(),fits:b.scrollWidth<=b.clientWidth})),logo:document.querySelector('.brand-wordmark').naturalWidth>0,verificationVisible:!document.getElementById('verify-tv').hidden})`)
    assert.equal(state.overflow, false); assert.ok(state.logo); assert.ok(state.buttons.every(b => b.fits), JSON.stringify(state.buttons))
    const addresses = await js(`(() => {
      const list = document.getElementById('host-ip')
      if (list.offsetParent === null) return null
      const bounds = document.querySelector('.preparation').getBoundingClientRect()
      return [...list.children].map(item => {
        const box = item.getBoundingClientRect(), text = document.createRange()
        text.selectNodeContents(item)
        const lines = [...text.getClientRects()]
        return { address: item.textContent, row: Math.round(box.top), fits: lines.length === 1 && lines[0].right <= box.right + 1 && box.right <= bounds.right + 1 && box.left >= bounds.left - 1 }
      })
    })()`)
    if (addresses) {
      assert.deepEqual(addresses.map(item => item.address), localAddresses)
      assert.ok(addresses.every(item => item.fits), JSON.stringify(addresses))
      const rows = addresses.reduce((counts, item) => { counts[item.row] = (counts[item.row] || 0) + 1; return counts }, {})
      state.addressesPerRow = Object.values(rows)
      assert.ok(state.addressesPerRow.every(count => count <= 3), JSON.stringify(state.addressesPerRow))
      if (name === '09-wide-ip-list') assert.equal(state.addressesPerRow[0], 3)
      if (name === '10-larger-text') assert.ok(state.addressesPerRow[0] < 3)
    }
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()); screenshots.push({ name, ...state })
  }
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html')); win.webContents.setZoomFactor(1); await js('document.fonts.ready')
  await waitFor("document.getElementById('host-ip').textContent.startsWith('192.0.2.20')")
  assert.ok(await js("document.querySelector('.tv-steps').textContent.includes('5 seconds')"))
  await capture('01-connect')
  win.setSize(1600, 900); await capture('09-wide-ip-list')
  win.setSize(1120, 840)
  await js("document.getElementById('connect-form').requestSubmit()")
  assert.equal(await js("document.getElementById('ip-error').hidden"), false); assert.equal(calls.length, 0)
  await js("document.getElementById('tv-ip').value='192.0.2.10';document.getElementById('connect-form').requestSubmit()")
  await waitFor("!document.getElementById('install-view').hidden")
  await capture('02-install-options')
  await js("document.getElementById('install').click()")
  await waitFor("document.getElementById('progress').value===38")
  await capture('03-download')
  win.webContents.send('installer:verify-key')
  await waitFor("document.activeElement.id==='tv-code'")
  await capture('04-verify-tv')
  await js("document.getElementById('tv-code').value='ABCD';document.getElementById('verify-tv').requestSubmit()")
  assert.equal(verificationCount, 0); assert.equal(await js("document.getElementById('code-error').hidden"), false)
  await js("document.getElementById('tv-code').value='ABCD-1234-EF56';document.getElementById('verify-tv').requestSubmit()")
  await waitFor("!document.getElementById('finish-view').hidden")
  assert.equal(verificationCount, 1); await capture('05-finish')
  await js("document.querySelector('#finish-view [data-view-logs]').click()")
  assert.ok(await js("document.getElementById('activity').open && document.getElementById('log').textContent.includes('install started')"))
  await js("document.getElementById('start-over').click();document.getElementById('tv-ip').value='192.0.2.10';document.getElementById('connect-form').requestSubmit()")
  await waitFor("!document.getElementById('install-view').hidden")
  failInstall = true
  await js("document.getElementById('install').click()")
  await waitFor("!document.getElementById('error-panel').hidden")
  assert.ok(await js("document.getElementById('error-message').textContent.includes('118012')")); await capture('06-error')
  assert.ok(await js("document.getElementById('activity').open && document.getElementById('log').textContent.includes('Samsung certificate rejected')"))
  await js("document.querySelector('#error-panel [data-view-logs]').click();document.getElementById('copy-logs').click()")
  await waitFor("document.getElementById('log-status').textContent==='Logs copied.'")
  assert.match(copiedLogs, /connect started/); assert.match(copiedLogs, /vd_appinstall/); assert.match(copiedLogs, /118012/)
  await js("document.getElementById('save-logs').click()")
  await waitFor("document.getElementById('log-status').textContent==='Save canceled.'")
  cancelSave = false
  await js("document.getElementById('save-logs').click()")
  await waitFor("document.getElementById('log-status').textContent==='Logs saved.'")
  await capture('08-installation-logs')
  await js("document.getElementById('open-logs').click()")
  await waitFor("document.getElementById('log-status').textContent==='Saved logs opened.'")
  failInstall = false
  await js("document.getElementById('enable-updater').checked=false;document.getElementById('install').click()")
  await waitFor("!document.getElementById('finish-view').hidden")
  assert.equal(await js("document.getElementById('finish-setup').hidden"), true)
  assert.equal(await js("document.getElementById('companion-ready').hidden"), false)
  await js("document.getElementById('start-over').click()")
  assert.ok(await js("document.getElementById('log').textContent.includes('118012')"))
  await js("document.getElementById('activity').open=false;window.scrollTo(0,0)")
  win.setSize(900, 740); await capture('07-small-window')
  win.webContents.setZoomFactor(1.25)
  await js("document.querySelector('.tv-steps').scrollIntoView({block:'start'})")
  await capture('10-larger-text')
  win.webContents.setZoomFactor(1)
  failConnect = true
  await js("document.getElementById('tv-ip').value='192.0.2.10';document.getElementById('connect-form').requestSubmit()")
  await waitFor("!document.getElementById('error-panel').hidden")
  assert.equal(await js("document.getElementById('connect').disabled"), false)
  assert.deepEqual(errors, [])
  assert.deepEqual(logActions, ['copy', 'save', 'save', 'open'])
  await js("document.getElementById('cloudflare-setup').click()")
  await waitFor('!document.getElementById("cloudflare-setup").disabled')
  assert.equal(cloudflareOpened, 1)
  win.setSize(390, 844)
  await js("document.getElementById('error-panel').hidden=true;window.scrollTo(0,0)")
  await capture('11-phone-layout')
  assert.ok(await js('document.documentElement.scrollWidth <= window.innerWidth'), 'Phone layout must not scroll horizontally')
  fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ screenshots, errors, calls, verificationCount, logActions }, null, 2))
  console.log('Installer UI passed: IP order and three-column limit across window sizes, connect, validation, download, TV verification, finish, failure logs, copy/save/open logs, retry, Companion-only setup and small window.')
  win.destroy(); app.quit()
}).catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); console.error(error); app.exit(1) })
