import { useLayoutEffect, useState } from 'preact/hooks'
import { ArrowLeft, LockKeyhole } from 'lucide-preact'
import { chooseTvProfile, tvHousehold, tvProfileId, tvProfileReady, type TvProfile } from '../lib/profiles'
import { profileAvatarUrl } from '../lib/profile-avatars'
import izumiMark from '../../brand/svg/izumi-mark-color.svg'
import './ProfileScreen.css'

export const PROFILE_REMOTE = 'izumi-profile-remote'
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Delete', '0', 'Continue']

export function ProfileScreen({ onChoose, onRefresh }: { onChoose(): void; onRefresh(): void }) {
  const profiles = tvHousehold().profiles
  const [focus, setFocus] = useState(Math.max(0, profiles.findIndex((item) => item.id === tvProfileId())))
  const [target, setTarget] = useState<TvProfile | null>(null)
  const [manage, setManage] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [keyFocus, setKeyFocus] = useState(0)

  async function choose(profile: TvProfile, code = '') {
    if (busy) return
    if (profile.pin && !code) { setTarget(profile); setPin(''); setError(''); setKeyFocus(0); return }
    setBusy(true)
    try {
      if (await chooseTvProfile(profile.id, code)) onChoose()
      else { setError('That PIN isn’t right. Please try again.'); setPin(''); setKeyFocus(0) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to unlock this profile.') }
    finally { setBusy(false) }
  }
  function press(key: string) {
    if (busy) return
    if (key === 'Delete') setPin((value) => value.slice(0, -1))
    else if (key === 'Continue') { if (target && pin.length >= 4) void choose(target, pin) }
    else setPin((value) => (value + key).slice(0, 6))
  }
  function back() {
    if (target) { setTarget(null); setError(''); setPin('') }
    else if (manage) { setManage(false); setFocus(0) }
    else if (tvProfileReady()) onChoose()
  }
  useLayoutEffect(() => {
    const remote = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'back') { back(); return }
      if (target) {
        if (action === 'left') setKeyFocus(Math.max(0, keyFocus - 1))
        if (action === 'right') setKeyFocus(Math.min(11, keyFocus + 1))
        if (action === 'up') setKeyFocus(Math.max(0, keyFocus - 3))
        if (action === 'down') setKeyFocus(Math.min(11, keyFocus + 3))
        if (action === 'select') press(keys[keyFocus])
      } else if (manage) {
        if (action === 'left' || action === 'up') setFocus(0)
        if (action === 'right' || action === 'down') setFocus(1)
        if (action === 'select') focus === 0 ? onRefresh() : back()
      } else {
        if (action === 'left') setFocus(Math.max(0, focus - 1))
        if (action === 'right') setFocus(Math.min(profiles.length - 1, focus + 1))
        if (action === 'down') setFocus(profiles.length)
        if (action === 'up') setFocus(0)
        if (action === 'select') focus >= profiles.length ? (setManage(true), setFocus(0)) : void choose(profiles[focus])
      }
    }
    const digits = (event: KeyboardEvent) => {
      if (target && /^\d$/.test(event.key)) { event.preventDefault(); press(event.key) }
    }
    window.addEventListener(PROFILE_REMOTE, remote)
    window.addEventListener('keydown', digits)
    return () => { window.removeEventListener(PROFILE_REMOTE, remote); window.removeEventListener('keydown', digits) }
  })
  useLayoutEffect(() => {
    document.querySelector<HTMLButtonElement>('.tv-profiles .is-profile-focused')?.focus()
  }, [focus, target, keyFocus, manage])

  return <section class="tv-profiles" role="dialog" aria-modal="true" aria-labelledby="tv-profile-title">
    {(target || manage || tvProfileReady()) && <button class="tv-profiles-back" aria-label="Back" onClick={back}><ArrowLeft size={32}/></button>}
    <div class="tv-profiles-content">
      <img class="tv-profiles-mark" src={izumiMark} alt="Izumi"/>
      <h1 id="tv-profile-title">{target ? `Welcome back, ${target.name}` : manage ? 'Manage profiles' : 'Who’s watching?'}</h1>
      {target ? <>
        <p class="tv-profiles-hint">Enter your profile PIN</p>
        <div class="tv-pin-dots" aria-label={`${pin.length} digits entered`}>{Array.from({ length: 6 }, (_, index) => <i class={index < pin.length ? 'filled' : ''} />)}</div>
        <p class="tv-profile-error" role="status">{error || (busy ? 'Unlocking…' : '\u00a0')}</p>
        <div class="tv-pin-keys">{keys.map((key, index) => <button class={keyFocus === index ? 'is-profile-focused' : ''} disabled={busy || key === 'Continue' && pin.length < 4} onMouseEnter={() => setKeyFocus(index)} onClick={() => press(key)}>{key}</button>)}</div>
      </> : manage ? <>
        <p class="tv-profiles-instructions">Personalise names, avatars and viewing limits in<br/><strong>Izumi → Settings → Profiles</strong><br/>on your phone or computer.</p>
        <p class="tv-profiles-hint">Your private Cloudflare sync brings those changes to this TV.</p>
        <div class="tv-profile-actions"><button class={focus === 0 ? 'is-profile-focused' : ''} onMouseEnter={() => setFocus(0)} onClick={onRefresh}>Refresh profiles</button><button class={focus === 1 ? 'is-profile-focused' : ''} onMouseEnter={() => setFocus(1)} onClick={back}>Done</button></div>
      </> : <>
        <div class={`tv-profile-tiles${profiles.length > 5 ? ' is-dense' : ''}`}>{profiles.map((profile, index) => <button class={`tv-profile-tile${focus === index ? ' is-profile-focused' : ''}`} onMouseEnter={() => setFocus(index)} onClick={() => void choose(profile)}>
          <img src={profileAvatarUrl(profile.avatar, profile.color)} alt=""/>
          <span>{profile.name}</span><small>{profile.pin ? <LockKeyhole size={22}/> : '\u00a0'}</small>
        </button>)}</div>
        <button class={`tv-profile-manage${focus >= profiles.length ? ' is-profile-focused' : ''}`} onMouseEnter={() => setFocus(profiles.length)} onClick={() => { setManage(true); setFocus(0) }}>Manage profiles</button>
      </>}
    </div>
  </section>
}
