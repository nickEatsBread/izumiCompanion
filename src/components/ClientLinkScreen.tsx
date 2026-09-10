import { ArrowLeft, CheckCircle2, Link2, QrCode } from 'lucide-preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import QRCode from 'qrcode'
import { CLIENT_LINK_REMOTE, CLIENT_LINK_TTL_MS, ClientLinkSession, formatClientLinkCode, type ClientLinkCode, type ClientLinkIdentity } from '../lib/client-link'
import { PROFILES_CHANGED, tvProfileReady } from '../lib/profiles'
import type { RemoteAction } from '../lib/remote'
import './ClientLinkScreen.css'

export { CLIENT_LINK_REMOTE } from '../lib/client-link'

type View =
  | { phase: 'loading' | 'linked' | 'expired' }
  | { phase: 'waiting'; details: ClientLinkCode }
  | { phase: 'error' | 'unavailable'; message: string }

export function ClientLinkScreen({ identity, showPreviewTools, onBack }: {
  identity: ClientLinkIdentity | null
  showPreviewTools: boolean
  onBack(): void
}) {
  const [view, setView] = useState<View>({ phase: 'loading' })
  const [focus, setFocus] = useState(0)
  const [remaining, setRemaining] = useState(600)
  const [qr, setQr] = useState('')
  const [qrUnavailable, setQrUnavailable] = useState(false)
  const root = useRef<HTMLElement>(null)
  const session = useRef<ClientLinkSession | null>(null)
  const generation = useRef(0)
  const mounted = useRef(false)
  const pollTimer = useRef<number>()
  const countdown = useRef<number>()
  const canGenerate = view.phase !== 'loading' && view.phase !== 'unavailable'

  function stop() {
    generation.current += 1
    window.clearTimeout(pollTimer.current)
    window.clearInterval(countdown.current)
    const previous = session.current
    session.current = null
    if (previous) void previous.cancel()
  }

  function back() { stop(); onBack() }

  function generate() {
    stop()
    setQr('')
    setQrUnavailable(false)
    setFocus(0)
    if (!showPreviewTools && !tvProfileReady()) {
      setView({ phase: 'error', message: 'Choose and unlock your profile, then retry.' })
      return
    }
    if (!showPreviewTools && !identity) {
      setView({ phase: 'unavailable', message: 'Pair this TV with izumi and connect private Cloudflare sync there before it can link another device. Your existing pairing is kept.' })
      return
    }
    setView({ phase: 'loading' })
    const currentGeneration = generation.current
    const current = () => mounted.current && currentGeneration === generation.current

    function finish(phase: 'expired' | 'linked') {
      if (!current()) return
      stop()
      setQr('')
      setView({ phase })
      setFocus(0)
    }

    function showCode(details: ClientLinkCode) {
      if (!current()) return
      setView({ phase: 'waiting', details })
      setRemaining(Math.max(0, Math.ceil((details.expiresAt - Date.now()) / 1000)))
      countdown.current = window.setInterval(() => {
        if (!current()) return
        const seconds = Math.max(0, Math.ceil((details.expiresAt - Date.now()) / 1000))
        setRemaining(seconds)
        if (!seconds) finish('expired')
      }, 1000)
    }

    if (showPreviewTools) {
      // Deliberately invalid code and no QR/deep link: previews never create a session.
      showCode({ code: 'DEMO CODE ONLY NOTA LINK', address: 'https://your-worker.example.invalid', link: '', expiresAt: Date.now() + CLIENT_LINK_TTL_MS })
      return
    }

    const active = new ClientLinkSession(identity!.transport, identity!.deviceId, identity!.credential)
    session.current = active
    function fail(reason: unknown) {
      if (!current()) return
      stop()
      setQr('')
      setView({ phase: 'error', message: reason instanceof Error ? reason.message : 'Unable to link this device. Please retry.' })
      setFocus(0)
    }
    async function poll() {
      try {
        const state = await active.poll()
        if (!current()) return
        if (state === 'waiting') pollTimer.current = window.setTimeout(() => void poll(), 2000)
        else finish(state)
      } catch (reason) { fail(reason) }
    }
    void active.start().then((details) => {
      if (!current()) { void active.cancel(); return }
      showCode(details)
      void QRCode.toDataURL(details.link, { width: 480, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#080808', light: '#ffffff' } }).then(
        (data) => { if (current()) setQr(data) },
        () => { if (current()) setQrUnavailable(true) },
      )
      pollTimer.current = window.setTimeout(() => void poll(), 2000)
    }, fail)
  }

  useLayoutEffect(() => {
    mounted.current = true
    generate()
    const profileChanged = () => {
      if (showPreviewTools || (tvProfileReady() && (!session.current || session.current.isProfileCurrent()))) return
      stop()
      setQr('')
      setView({ phase: 'error', message: 'Your profile changed or locked. Choose and unlock your profile, then retry.' })
      setFocus(0)
    }
    window.addEventListener(PROFILES_CHANGED, profileChanged)
    return () => {
      mounted.current = false
      stop()
      window.removeEventListener(PROFILES_CHANGED, profileChanged)
    }
  }, [showPreviewTools, identity?.deviceId, identity?.credential, identity?.transport.endpoint, identity?.transport.pairingId, identity?.transport.tvToken, identity?.transport.recoveryKey, identity?.transport.playbackMode, identity?.transport.wakeWhenClosed])

  useLayoutEffect(() => {
    const remote = (event: Event) => {
      const action = (event as CustomEvent<RemoteAction>).detail
      if (action === 'back') back()
      else if (action === 'left' || action === 'up') setFocus(0)
      else if (action === 'right' || action === 'down') setFocus(canGenerate ? 1 : 0)
      else if (action === 'select') focus === 1 && canGenerate ? generate() : back()
    }
    window.addEventListener(CLIENT_LINK_REMOTE, remote)
    return () => window.removeEventListener(CLIENT_LINK_REMOTE, remote)
  })

  useLayoutEffect(() => {
    const button = root.current?.querySelector<HTMLButtonElement>('.is-focused')
    try { button?.focus({ preventScroll: true }) }
    catch { button?.focus() }
    // Chromium 56 ignores preventScroll; keep the TV viewport at its origin after focus.
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
  }, [focus, view.phase])

  return (
    <main class="client-link-screen" ref={root} aria-label="Link phone or desktop">
      <header class="client-link-heading">
        <p>Settings / Connection</p>
        <h1>Link phone or desktop</h1>
        <span>Bring this TV’s saved connection to another izumi device.</span>
      </header>
      <div class="client-link-content">
        <section class="client-link-instructions">
          <h2>On your phone or desktop</h2>
          <div class="client-link-methods">
            <p>Scan the QR code with your <strong>phone camera</strong> to open izumi.</p>
            <p>Or open the full izumi app, go to <strong>Settings → Device sync → TV → Restore from TV</strong>, and enter the Worker address and code shown here.</p>
          </div>
          <p class="client-link-note">Each code works once and is valid for 10 minutes. Keep this screen open while you link your device.</p>
          {showPreviewTools && <p class="client-link-preview-label">Preview · Illustrative only. This code cannot link a device.</p>}
          <div class={`client-link-status is-${view.phase}`} role={view.phase === 'error' ? 'alert' : 'status'}>
            {view.phase === 'loading' && <><i class="client-link-spinner" /><span>Preparing a secure link…</span></>}
            {view.phase === 'waiting' && <><Link2 size={28} /><span>Waiting for your phone or desktop</span></>}
            {view.phase === 'linked' && <><CheckCircle2 size={32} /><span><strong>Device linked successfully</strong><small>You can now continue in izumi on your phone or desktop.</small></span></>}
            {view.phase === 'expired' && <span><strong>This code has expired</strong><small>Generate a new code to link your device.</small></span>}
            {(view.phase === 'error' || view.phase === 'unavailable') && <span>{view.message}</span>}
          </div>
        </section>
        {view.phase === 'waiting' && (
          <section class="client-link-code-panel" aria-label="Restore from TV code">
            <div class="client-link-qr">
              {qr ? <img src={qr} alt="Scan with your phone camera to restore this TV connection in izumi" />
                : <div class="client-link-qr-placeholder"><QrCode size={80} /><span>{showPreviewTools ? 'Illustrative preview' : qrUnavailable ? 'Use the manual code below' : 'Preparing QR code…'}</span></div>}
            </div>
            <div class="client-link-address"><span>Worker address</span><strong>{view.details.address}</strong></div>
            <div class="client-link-manual"><span>One-time code</span><strong>{formatClientLinkCode(view.details.code)}</strong></div>
            <p class="client-link-countdown">Expires in <time>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</time></p>
          </section>
        )}
      </div>
      <footer class="client-link-actions">
        <button type="button" class={focus === 0 ? 'is-focused' : ''} tabIndex={focus === 0 ? 0 : -1} onFocus={() => setFocus(0)} onMouseEnter={() => setFocus(0)} onClick={back}><ArrowLeft size={24} />Back</button>
        {canGenerate && <button type="button" class={focus === 1 ? 'is-focused' : ''} tabIndex={focus === 1 ? 0 : -1} onFocus={() => setFocus(1)} onMouseEnter={() => setFocus(1)} onClick={generate}>{view.phase === 'error' ? 'Retry' : 'Generate new code'}</button>}
      </footer>
    </main>
  )
}
