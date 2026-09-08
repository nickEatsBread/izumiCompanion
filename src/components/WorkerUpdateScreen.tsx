import { ArrowLeft, Cloud, RefreshCw } from 'lucide-preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { RemoteAction } from '../lib/remote'
import { workerUpdateMessage, type WorkerUpdateStatus, WORKER_UPDATE_REMOTE } from '../lib/worker-update'
import './ClientLinkScreen.css'

export function WorkerUpdateScreen({ endpoint, update, onBack }: {
  endpoint: string
  update(trigger: boolean, cancellation: { cancel?: () => void }): Promise<WorkerUpdateStatus>
  onBack(): void
}) {
  const [focus, setFocus] = useState(0)
  const [checking, setChecking] = useState(true)
  const [status, setStatus] = useState<WorkerUpdateStatus | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const cancellation = useRef<{ cancel?: () => void }>({})
  const busy = useRef(false)
  const buttons = useRef<Array<HTMLButtonElement | null>>([])

  function check(trigger = false) {
    if (busy.current) return
    busy.current = true
    const current = ++generation.current
    setChecking(true)
    setError('')
    void update(trigger, cancellation.current).then(value => {
      if (generation.current === current) setStatus(value)
    }).catch(reason => {
      if (generation.current === current) setError(reason instanceof Error ? reason.message : 'Unable to check the Worker.')
    }).finally(() => { if (generation.current === current) { busy.current = false; setChecking(false) } })
  }

  useLayoutEffect(() => {
    busy.current = false
    setStatus(null)
    check()
    return () => { generation.current += 1; cancellation.current.cancel?.() }
  }, [endpoint])

  useLayoutEffect(() => {
    const pending = status?.phase === 'queued' || status?.phase === 'checking'
    if (!pending && !(status?.retryAt && status.retryAt > Date.now())) return
    const timer = window.setInterval(() => check(), pending ? 15_000 : 60_000)
    return () => window.clearInterval(timer)
  }, [status?.phase, status?.retryAt, endpoint])

  const trigger = !!status?.configured && !['queued', 'checking', 'delayed'].includes(status.phase)

  useLayoutEffect(() => { buttons.current[focus]?.focus() }, [focus])
  useLayoutEffect(() => {
    const remote = (event: Event) => {
      const action = (event as CustomEvent<RemoteAction>).detail
      if (action === 'back') onBack()
      else if (action === 'left' || action === 'up') setFocus(0)
      else if (action === 'right' || action === 'down') setFocus(1)
      else if (action === 'select') { if (focus === 0) onBack(); else if (!checking) check(trigger) }
    }
    window.addEventListener(WORKER_UPDATE_REMOTE, remote)
    return () => window.removeEventListener(WORKER_UPDATE_REMOTE, remote)
  }, [focus, checking, endpoint, onBack, trigger])

  return <main class="client-link-screen" aria-label="Update Worker">
    <header class="client-link-heading"><p>PRIVATE CLOUDFLARE</p><h1>Update Worker</h1>
      <span>Keep your existing Worker, saved progress and TV connection.</span></header>
    <div class="client-link-content" style={{ gridTemplateColumns: '1fr' }}>
      <section class="client-link-instructions">
        <h2>Automatic Worker updates</h2>
        <div class="client-link-methods">
          {status?.configured ? <>
            <p>Your Worker installs stable updates from Izumi automatically.</p>
            <p>{status.automatic ? 'Automatic checks run every six hours, even with your TV switched off.' : 'Automatic updates are paused in Cloudflare settings.'}</p>
            <p>Select <strong>Update now</strong> to check sooner. You can leave this screen while it installs.</p>
          </> : status ? <p>Update this Worker from Izumi. That update enables future automatic updates.</p>
            : <p>Checking automatic update status…</p>}
        </div>
        <div class={`client-link-status${error || status?.phase === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
          <Cloud size={30} /><span>{checking ? 'Checking your Worker…' : error || (status ? workerUpdateMessage(status) : 'Worker status unavailable.')}
            <small>{status ? `Installed Worker version ${status.version}` : 'Your existing Worker address and device pairing stay in place.'}</small></span>
        </div>
      </section>
    </div>
    <footer class="client-link-actions">
      <button ref={element => { buttons.current[0] = element }} type="button" class={focus === 0 ? 'is-focused' : ''} tabIndex={focus === 0 ? 0 : -1}
        onFocus={() => setFocus(0)} onMouseEnter={() => setFocus(0)} onClick={onBack}><ArrowLeft size={22} /> Back</button>
      <button ref={element => { buttons.current[1] = element }} type="button" class={focus === 1 ? 'is-focused' : ''} tabIndex={focus === 1 ? 0 : -1} aria-disabled={checking}
        onFocus={() => setFocus(1)} onMouseEnter={() => setFocus(1)} onClick={() => { if (!checking) check(trigger) }}><RefreshCw size={22} /> {checking ? 'Checking…' : trigger ? 'Update now' : 'Check again'}</button>
    </footer>
  </main>
}
