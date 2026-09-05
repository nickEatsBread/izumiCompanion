const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { createInstaller } = require('./installer-core.cjs')
const { openCloudflareSetup } = require('./cloudflare-window.cjs')

// Keep the existing TV author identity across desktop installer upgrades.
app.setPath('userData', path.join(app.getPath('appData'), 'izumi-tv-installer'))
let mainWindow
const installer = createInstaller({
  userData: app.getPath('userData'), appData: app.getPath('appData'), version: app.getVersion(),
  openExternal: url => shell.openExternal(url),
  onEvent: (type, value) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(type, value) },
})
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120, height: 840, minWidth: 900, minHeight: 740,
    backgroundColor: '#0c0e10', icon: path.join(__dirname, '..', 'assets', 'icon.png'), title: 'izumi Companion Installer',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => { installer.dispose(); mainWindow = undefined })
  void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}
app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.nicho.izumi.tvinstaller')
  createWindow()
  app.on('activate', () => { if (!mainWindow) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Open the installer to perform this action.')
    return callback(event, ...args)
  })
}
handle('installer:get-config', () => installer.getConfig())
handle('installer:run', (_event, request) => installer.run(request))
handle('installer:verify-code', (_event, code) => installer.verifyCode(code))
handle('installer:cloudflare-setup', () => { openCloudflareSetup(); return { ok: true } })
handle('installer:copy-logs', () => { clipboard.writeText(installer.logs.text()); return { ok: true } })
handle('installer:save-logs', async event => {
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Save installation logs', defaultPath: path.join(app.getPath('downloads'), path.basename(installer.logs.filename)),
    filters: [{ name: 'Installation log', extensions: ['log', 'txt'] }],
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await fsp.writeFile(result.filePath, installer.logs.text(), 'utf8')
  return { ok: true }
})
handle('installer:open-logs', async () => {
  await fsp.mkdir(installer.logs.directory, { recursive: true })
  const error = await shell.openPath(installer.logs.directory)
  if (error) throw new Error(error)
  return { ok: true }
})
