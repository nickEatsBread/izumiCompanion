const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('izumiInstaller', {
  getConfig: () => ipcRenderer.invoke('installer:get-config'),
  openCloudflareSetup: () => ipcRenderer.invoke('installer:cloudflare-setup'),
  run: (request) => ipcRenderer.invoke('installer:run', request),
  verifyCode: (code) => ipcRenderer.invoke('installer:verify-code', code),
  copyLogs: () => ipcRenderer.invoke('installer:copy-logs'),
  saveLogs: () => ipcRenderer.invoke('installer:save-logs'),
  openLogs: () => ipcRenderer.invoke('installer:open-logs'),
  onStage: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('installer:stage', listener)
    return () => ipcRenderer.removeListener('installer:stage', listener)
  },
  onVerifyKey: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('installer:verify-key', listener)
    return () => ipcRenderer.removeListener('installer:verify-key', listener)
  },
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry)
    ipcRenderer.on('installer:log', listener)
    return () => ipcRenderer.removeListener('installer:log', listener)
  },
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('installer:progress', listener)
    return () => ipcRenderer.removeListener('installer:progress', listener)
  },
})
