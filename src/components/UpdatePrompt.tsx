import { useEffect, useRef, useState } from 'preact/hooks'
import { checkTvUpdate, launchUpdater, type TvUpdate } from '../lib/updates'
import type { RemoteAction } from '../lib/remote'
import wordmark from '../../brand/svg/izumi-wordmark-white.svg'
import './UpdatePrompt.css'

const DISMISS_KEY = 'izumi.tv.update-dismissed'
function recentlyDismissed(version: string): boolean {
  try { const value = JSON.parse(localStorage.getItem(DISMISS_KEY) || 'null'); return value?.version === version && Date.now() - Number(value.at) < 24 * 60 * 60 * 1000 } catch { return false }
}
export function useUpdatePrompt(eligible: boolean, restoreFocus: () => void) {
  const [update, setUpdate] = useState<TvUpdate>()
  const [choice, setChoice] = useState(0)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const lastCheck = useRef(0)
  const visible = Boolean(update && eligible)
  useEffect(() => {
    let disposed = false, checking = false
    const check = () => {
      if (checking || document.hidden || Date.now() - lastCheck.current < 6 * 60 * 60 * 1000) return
      checking = true; lastCheck.current = Date.now()
      void checkTvUpdate().then((result) => {
        if (!disposed && result && !recentlyDismissed(result.version)) { setUpdate(result); setChoice(0); setError('') }
      }).finally(() => { checking = false })
    }
    const timer = window.setTimeout(check, 30000)
    const interval = window.setInterval(check, 6 * 60 * 60 * 1000)
    document.addEventListener('visibilitychange', check)
    return () => { disposed = true; window.clearTimeout(timer); window.clearInterval(interval); document.removeEventListener('visibilitychange', check) }
  }, [])
  const dismiss = () => {
    if (launching) return
    if (update) try { localStorage.setItem(DISMISS_KEY, JSON.stringify({ version: update.version, at: Date.now() })) } catch { /* Session dismissal still works. */ }
    setUpdate(undefined); setError(''); restoreFocus()
  }
  const install = () => {
    if (launching) return
    setLaunching(true); setError('')
    void launchUpdater(true).then(() => { setUpdate(undefined); restoreFocus() }).catch((reason: Error) => setError(reason.message)).finally(() => setLaunching(false))
  }
  const handleRemote = (action: RemoteAction) => {
    if (!visible) return false
    if (launching) return true
    if (action === 'left' || action === 'up') setChoice(0)
    else if (action === 'right' || action === 'down') setChoice(1)
    else if (action === 'select') choice === 0 ? install() : dismiss()
    else if (action === 'back') dismiss()
    return true
  }
  return { visible, update, choice, setChoice, launching, error, dismiss, install, handleRemote }
}
export function UpdatePrompt({ prompt }: { prompt: ReturnType<typeof useUpdatePrompt> }) {
  const first = useRef<HTMLButtonElement>(null), second = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (prompt.visible) (prompt.choice === 0 ? first : second).current?.focus() }, [prompt.visible, prompt.choice])
  if (!prompt.visible || !prompt.update) return null
  return <div class="tv-update-backdrop">
    <section class="tv-update-dialog" role="dialog" aria-modal="true" aria-labelledby="tv-update-heading" aria-describedby="tv-update-message">
      <div class="tv-update-brand"><img src={wordmark} alt="izumi" /><p class="tv-update-eyebrow">Companion · {prompt.update.version}</p></div>
      <h2 id="tv-update-heading">An update is ready.</h2>
      <p id="tv-update-message">{prompt.error || (prompt.update.helperInstalled ? 'Update now and we’ll bring you right back to izumi when it’s ready.' : 'Use the desktop installer to install this update and set up izumi Updater for future updates on your TV.')}</p>
      <div class="tv-update-actions">
        <button ref={first} class={prompt.choice === 0 ? 'is-focused' : ''} disabled={prompt.launching} onFocus={() => prompt.setChoice(0)} onClick={prompt.install}>{prompt.launching ? 'Opening updater…' : prompt.update.helperInstalled ? 'Update now' : 'Set up updates'}</button>
        <button ref={second} class={prompt.choice === 1 ? 'is-focused' : ''} disabled={prompt.launching} onFocus={() => prompt.setChoice(1)} onClick={prompt.dismiss}>Later</button>
      </div>
    </section>
  </div>
}
