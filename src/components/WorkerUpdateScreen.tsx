import { ArrowLeft, Cloud, RefreshCw } from 'lucide-preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import QRCode from 'qrcode'
import type { RemoteAction } from '../lib/remote'
import { checkWorkerVersion, WORKER_UPDATE_GUIDE, WORKER_UPDATE_REMOTE } from '../lib/worker-update'
import './ClientLinkScreen.css'

export function WorkerUpdateScreen({ endpoint, onBack }: { endpoint: string; onBack(): void }) {
  const [focus, setFocus] = useState(0)
  const [qr, setQr] = useState('')
  const [checking, setChecking] = useState(true)
  const [version, setVersion] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  function check() {
    const current = ++generation.current
    setChecking(true)
    setError('')
    void checkWorkerVersion(endpoint).then(value => {
      if (generation.current === current) setVersion(value)
    }).catch(reason => {
      if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Unable to check the Worker.')
    }).finally(() => { if (generation.current === current) setChecking(false) })
  }

  useLayoutEffect(() => {
    let mounted = true
    check()
    void QRCode.toDataURL(WORKER_UPDATE_GUIDE, { width: 480, margin: 4 }).then(value => {
      if (mounted) setQr(value)
    }).catch(() => {})
    return () => { mounted = false; generation.current += 1 }
  }, [endpoint])

  useLayoutEffect(() => { buttons.current[focus]?.focus() }, [focus])
  useLayoutEffect(() => {
    const remote = (event: Event) => {
      const action = (event as CustomEvent<RemoteAction>).detail
      if (action === 'back') onBack()
      else if (action === 'left' || action === 'up') setFocus(0)
      else if (action === 'right' || action === 'down') setFocus(1)
      else if (action === 'select') { if (focus === 0) onBack(); else if (!checking) check() }
    }
    window.addEventListener(WORKER_UPDATE_REMOTE, remote)
    return () => window.removeEventListener(WORKER_UPDATE_REMOTE, remote)
  }, [focus, checking, endpoint, onBack])

  return <main class="client-link-screen" aria-label="Update Worker">
    <header class="client-link-heading"><p>PRIVATE CLOUDFLARE</p><h1>Update Worker</h1>
      <span>Keep your existing Worker, saved progress and TV connection.</span></header>
    <div class="client-link-content">
      <section class="client-link-instructions">
        <h2>Continue on your phone or computer</h2>
        <div class="client-link-methods">
          <p>1. Open the latest <strong>Izumi</strong> on the device that created your Worker.</p>
          <p>2. Go to <strong>Settings → Device sync → Sync &amp; devices → Update Worker</strong>.</p>
          <p>3. Create a fresh Cloudflare token when prompted, install the update, then check again here.</p>
        </div>
        <p class="client-link-note">For a Worker deployed another way, scan the update guide. Cloudflare account access stays on your phone or computer.</p>
        <div class={`client-link-status${error ? ' is-error' : ''}`} role="status" aria-live="polite">
          <Cloud size={30} /><span>{checking ? 'Checking your Worker…' : error || `Installed Worker version ${version}`}
            <small>The latest Izumi app checks whether a newer Worker is available.</small></span>
        </div>
      </section>
      <aside class="client-link-code-panel" aria-label="Worker update guide">
        <div class="client-link-qr">{qr ? <img src={qr} alt="Scan to open the Worker update guide" />
          : <div class="client-link-qr-placeholder"><Cloud size={40} /><span>Use the address below for the guide.</span></div>}</div>
        <div class="client-link-address"><span>Update guide</span><strong>github.com/nickEatsBread/izumi</strong></div>
        <p class="client-link-note">Open cloudflare-sync-worker → Updating.</p>
      </aside>
    </div>
    <footer class="client-link-actions">
      <button ref={element => { buttons.current[0] = element }} type="button" class={focus === 0 ? 'is-focused' : ''} tabIndex={focus === 0 ? 0 : -1}
        onFocus={() => setFocus(0)} onMouseEnter={() => setFocus(0)} onClick={onBack}><ArrowLeft size={22} /> Back</button>
      <button ref={element => { buttons.current[1] = element }} type="button" class={focus === 1 ? 'is-focused' : ''} tabIndex={focus === 1 ? 0 : -1} aria-disabled={checking}
        onFocus={() => setFocus(1)} onMouseEnter={() => setFocus(1)} onClick={() => { if (!checking) check() }}><RefreshCw size={22} /> {checking ? 'Checking…' : 'Check again'}</button>
    </footer>
  </main>
}
