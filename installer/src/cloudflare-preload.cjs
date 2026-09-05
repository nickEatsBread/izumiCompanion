const { contextBridge, ipcRenderer } = require('electron')

if (location.origin === 'https://tv-link.izumi.watch') {
  contextBridge.exposeInMainWorld('izumiCloudflare', {
    invoke: (method, input) => ipcRenderer.invoke('cloudflare:invoke', method, input),
  })
}
