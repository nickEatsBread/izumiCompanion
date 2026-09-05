(() => {
  const pending = new Map(), listeners = new Map()
  let nextId = 0
  const send = value => window.ReactNativeWebView.postMessage(JSON.stringify(value))
  function invoke(method, input) {
    return new Promise((resolve, reject) => {
      const id = 'installer-' + (++nextId)
      pending.set(id, { resolve, reject })
      send({ type: 'request', scope: 'installer', id, method, input })
    })
  }
  function receive(event) {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.type === 'result') {
      const promise = pending.get(message.id)
      if (!promise) return
      pending.delete(message.id)
      if (message.error) promise.reject(new Error(message.error)); else promise.resolve(message.result)
    } else if (message.type === 'event') for (const listener of listeners.get(message.event) || []) listener(message.value)
  }
  window.addEventListener('message', receive)
  document.addEventListener('message', receive)
  function on(event, listener) {
    const group = listeners.get(event) || new Set()
    group.add(listener); listeners.set(event, group)
    return () => group.delete(listener)
  }
  async function shareLogs() {
    const text = await invoke('logs')
    send({ type: 'share-logs', text })
    return { ok: true, shared: true }
  }
  window.izumiInstaller = {
    getConfig: () => invoke('getConfig'), run: input => invoke('run', input), verifyCode: code => invoke('verifyCode', code),
    openCloudflareSetup: async () => send({ type: 'open-cloudflare' }),
    copyLogs: shareLogs, saveLogs: shareLogs, openLogs: shareLogs,
    onStage: listener => on('installer:stage', listener), onProgress: listener => on('installer:progress', listener),
    onLog: listener => on('installer:log', listener), onVerifyKey: listener => on('installer:verify-key', listener),
  }
})()
