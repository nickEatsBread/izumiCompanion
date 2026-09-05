// Installed only in the Cloudflare wizard WebView; TV installation is exposed
// separately to our packaged local interface.
export const cloudflareBridge = `(() => {
  if (location.origin !== 'https://tv-link.izumi.watch' || window.izumiCloudflare) return;
  const pending = new Map(); let next = 0;
  function receive(event) {
    let value; try { value = JSON.parse(event.data); } catch { return; }
    if (value.type !== 'result') return;
    const request = pending.get(value.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(value.id);
    if (value.error) request.reject(new Error(value.error)); else request.resolve(value.result);
  }
  window.addEventListener('message', receive); document.addEventListener('message', receive);
  window.izumiCloudflare = {
    invoke(method, input) { return new Promise((resolve, reject) => {
      const id = 'cloudflare-' + (++next);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Cloudflare setup timed out. Keep the app open and retry.')); }, 600000);
      pending.set(id, { resolve, reject, timer });
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'request', scope: 'cloudflare', id, method, input }));
    }); },
    saveRecovery(text) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'share-recovery', text })); return Promise.resolve(); }
  };
  window.dispatchEvent(new Event('izumi-native-ready'));
})(); true;`
