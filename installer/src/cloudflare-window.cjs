const { BrowserWindow, ipcMain, shell } = require('electron')
const path = require('node:path')
const ORIGIN = 'https://tv-link.izumi.watch'
let setupWindow

ipcMain.handle('cloudflare:invoke', async (event, method, input) => {
  if (!setupWindow || event.sender !== setupWindow.webContents || event.senderFrame !== setupWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== ORIGIN) throw new Error('Cloudflare setup is not open in the installer.')
  return require('./cloudflare/cloudflare.cjs').invoke(method, input)
})

function openCloudflareSetup() {
  // Fail before opening the wizard if an incomplete development build is used.
  require.resolve('./cloudflare/cloudflare.cjs')
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return }
  setupWindow = new BrowserWindow({ width: 1080, height: 860, minWidth: 480, minHeight: 600, title: 'izumi · TV Cloudflare setup', backgroundColor: '#0c0e10', icon: path.join(__dirname, '../assets/icon.png'), webPreferences: { preload: path.join(__dirname, 'cloudflare-preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true } })
  setupWindow.setMenuBarVisibility(false)
  setupWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== ORIGIN) event.preventDefault() })
  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
    return { action: 'deny' }
  })
  setupWindow.on('closed', () => { setupWindow = undefined })
  void setupWindow.loadURL(ORIGIN)
}

module.exports = { openCloudflareSetup }
