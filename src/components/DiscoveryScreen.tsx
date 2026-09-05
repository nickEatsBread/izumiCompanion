import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Play, Bookmark, ArrowRight, Info, Undo2, EyeOff, RefreshCw, ArrowLeft } from 'lucide-preact'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'
import type { CompanionReceiver, CompanionTrailerSource } from '../lib/receiver'
import { DISCOVERY_REMOTE, DISCOVERY_CHANGED, readDiscoveryChoices, persistDiscoveryChoice, discoveryChoiceMedia, tvDiscoveryDeck, discoveryKey, type DiscoveryChoice } from '../lib/discovery'
import { tvProfileId } from '../lib/profiles'
import { TrailerPlayer, TRAILER_CONTROL_EVENT } from './CatalogScreens'
import './DiscoveryScreen.css'

interface Props { snapshot: CompanionHomeSnapshot; receiver?: CompanionReceiver; onDetails(media: CompanionMedia): void; onBack(): void }
export function DiscoveryScreen({ snapshot, receiver, onDetails, onBack }: Props) {
  const [choices, setChoices] = useState(readDiscoveryChoices)
  const [extra, setExtra] = useState<CompanionMedia[]>([])
  const [details, setDetails] = useState<CompanionMedia | null>(null)
  const [busy, setBusy] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [notice, setNotice] = useState('')
  const [focus, setFocus] = useState(1)
  const [last, setLast] = useState<CompanionMedia | null>(null)
  const [restored, setRestored] = useState('')
  const [trailer, setTrailer] = useState<CompanionTrailerSource | null>(null)
  const alive = useRef(true)
  const trailerRef = useRef<CompanionTrailerSource | null>(null)
  const view = useMemo(() => extra.length ? {
    ...snapshot, discovery: { version: 2 as const, excluded: [], decisions: [], ...snapshot.discovery,
      candidates: [...snapshot.discovery?.candidates ?? snapshot.rows.flatMap(row => row.items), ...extra] },
  } : snapshot, [snapshot, extra])
  const deck = useMemo(() => tvDiscoveryDeck(view, choices), [view, choices])
  const current = deck.find(item => item.key === restored) ?? deck[0]
  const currentKey = useRef(current?.key)
  currentKey.current = current?.key
  const media = details && current?.key === discoveryKey(details) ? details : current?.media
  const videoId = media?.trailer?.site?.toLowerCase() === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(media.trailer.id) ? media.trailer.id : ''
  const actions = [
    { label: enriching ? 'Finding trailer…' : 'Trailer', Icon: Play, disabled: !videoId },
    { label: 'Full details', Icon: Info, disabled: !media },
    { label: 'Save', Icon: Bookmark, disabled: !media },
    { label: 'Skip for now', Icon: ArrowRight, disabled: !media },
    { label: 'Not for me', Icon: EyeOff, disabled: !media },
    { label: 'Undo last', Icon: Undo2, disabled: !last },
    { label: busy ? 'Loading…' : 'Refresh picks', Icon: RefreshCw, disabled: busy },
    { label: 'My List', Icon: ArrowLeft, disabled: false },
  ]
  function closeTrailer() {
    const source = trailerRef.current
    trailerRef.current = null
    setTrailer(null)
    if (source) receiver?.releaseTrailer(source.requestId)
  }
  async function refresh() {
    if (busy) return
    setBusy(true)
    try {
      await receiver?.syncDiscoveryChoices().catch(() => {})
      const items = await receiver?.discoveryCandidates()
      if (!alive.current) return
      if (items?.length) { setExtra(items); setNotice('Catalogs refreshed. Personalized ordering updates when the main Izumi client syncs.') }
      else setNotice('Using the latest linked-device deck. Open Izumi to refresh device-only catalogs.')
    } catch { if (alive.current) setNotice('Using your current picks. Your cloud catalogs couldn’t refresh right now.') }
    finally { if (alive.current) setBusy(false) }
  }
  async function act(index: number) {
    if (actions[index]?.disabled) return
    if (index === 7) return onBack()
    if (index === 6) return refresh()
    if (index === 1 && media) return onDetails(media)
    if (index === 0 && videoId && media) {
      const openingKey = current?.key, openingProfile = tvProfileId()
      setNotice('Opening trailer…')
      try {
        const source = await receiver?.requestTrailer(videoId, media.title)
        if (source && alive.current && currentKey.current === openingKey && tvProfileId() === openingProfile) { trailerRef.current = source; setTrailer(source); setNotice('') }
        else if (source) receiver?.releaseTrailer(source.requestId)
        else setNotice('Connect this TV to play a trailer.')
      } catch (error) { if (alive.current) setNotice(error instanceof Error ? error.message : 'Trailer unavailable.') }
      return
    }
    const target = index === 5 ? last : media
    if (!target) return
    const action = index === 5 ? 'undo' : index === 2 ? 'save' : index === 3 ? 'skip' : 'dismiss'
    const choice: DiscoveryChoice = { profileId: tvProfileId(), media: discoveryChoiceMedia(target), action, at: Date.now(), pending: true }
    try { persistDiscoveryChoice(choice) }
    catch { setNotice('TV storage is full. This choice wasn’t saved.'); return }
    setRestored(action === 'undo' ? discoveryKey(target) : '')
    setLast(action === 'undo' ? null : target)
    setNotice(action === 'undo' ? 'Last choice undone.' : action === 'skip' ? 'Skipped for seven days.' : action === 'save' ? 'Saved to My List on this TV.' : 'Choice saved. Personalized picks update when the main client syncs.')
    try {
      if (await receiver?.sendDiscoveryChoice(choice)) {
        if (alive.current && tvProfileId() === choice.profileId) persistDiscoveryChoice({ ...choice, pending: false })
      } else if (alive.current) setNotice('Saved on this TV. Cloud sync is pending; it will retry when connected.')
    } catch { if (alive.current) setNotice('Saved on this TV. Cloud sync is pending; update your Worker if needed.') }
  }
  useEffect(() => {
    alive.current = true
    const changed = () => setChoices(readDiscoveryChoices())
    window.addEventListener(DISCOVERY_CHANGED, changed)
    void refresh()
    const syncTimer = window.setInterval(() => { void receiver?.syncDiscoveryChoices().catch(() => {}) }, 30_000)
    return () => { alive.current = false; window.clearInterval(syncTimer); window.removeEventListener(DISCOVERY_CHANGED, changed); if (trailerRef.current) receiver?.releaseTrailer(trailerRef.current.requestId) }
  }, [receiver])
  useEffect(() => {
    let cancelled = false
    setDetails(null)
    if (!current || !receiver) { setEnriching(false); return }
    setEnriching(true)
    void receiver?.requestDetails(current.media).then(value => { if (!cancelled && value) setDetails(value) })
      .catch(() => {}).finally(() => { if (!cancelled) setEnriching(false) })
    return () => { cancelled = true }
  }, [current?.key, receiver])
  useLayoutEffect(() => {
    const remote = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      if (trailer) {
        if (action === 'back' || action === 'stop') closeTrailer()
        else window.dispatchEvent(new CustomEvent(TRAILER_CONTROL_EVENT, { detail: action === 'select' || action === 'playPause' ? 'toggle' : action === 'left' ? 'seek-back' : action === 'right' ? 'seek-forward' : action }))
        return
      }
      if (action === 'back') return onBack()
      if (action === 'select') { void act(focus); return }
      const delta = action === 'left' ? -1 : action === 'right' ? 1 : action === 'up' ? -4 : action === 'down' ? 4 : 0
      if (delta) {
        let next = Math.max(0, Math.min(7, focus + delta))
        if (actions[next].disabled) {
          const step = delta > 0 ? 1 : -1
          while (next >= 0 && next < 8 && actions[next].disabled) next += step
        }
        if (next >= 0 && next < 8) setFocus(next)
      }
    }
    window.addEventListener(DISCOVERY_REMOTE, remote)
    return () => window.removeEventListener(DISCOVERY_REMOTE, remote)
  })
  useLayoutEffect(() => { if (!current && focus < 6) setFocus(7) }, [current?.key])
  useLayoutEffect(() => { document.querySelector<HTMLButtonElement>('.tv-discovery .discovery-focused')?.focus() }, [focus, current?.key, trailer])
  return <main class="tv-discovery">
    {media?.backdrop && <img class="tv-discovery-backdrop" src={media.backdrop} alt="" />}
    <div class="tv-discovery-shade" />
    <header><span>DISCOVER</span><small>{deck.length} picks · your enabled catalogs</small></header>
    <div class="tv-discovery-content">
      <div class="tv-discovery-info">
        <h1>{media?.title ?? 'You’re caught up'}</h1>
        <p class="tv-discovery-meta">{[media?.releaseYear, media?.runtimeMinutes ? media.runtimeMinutes + ' min' : '', media?.contentRating, media?.genres?.slice(0, 3).join(' / ')].filter(Boolean).join(' · ')}</p>
        <p class="tv-discovery-description">{media?.description?.replace(/<[^>]*>/g, '') || 'Try refreshing your catalogs for more titles. Skipped picks return after seven days.'}</p>
        {current && <section class="tv-discovery-why"><h2>Why this pick</h2><strong>{current.reason}</strong><p>{current.evidence.slice(0, 2).join(' ')}</p></section>}
      </div>
      {media?.poster && <img class="tv-discovery-poster" src={media.poster} alt="" />}
    </div>
    <div class="tv-discovery-actions">{actions.map(({ label, Icon, disabled }, index) => <button type="button" disabled={disabled} class={focus === index ? 'discovery-focused' : ''} onFocus={() => setFocus(index)} onMouseEnter={() => !disabled && setFocus(index)} onClick={() => void act(index)}><Icon size={23} />{label}</button>)}</div>
    <p class="tv-discovery-notice" role="status">{notice || 'Save what interests you. Personalized picks refresh through your linked Izumi client.'}</p>
    {trailer && media && <><TrailerPlayer videoId={videoId} title={media.title} backdrop={media.backdrop} source={trailer.url} /><button class="tv-discovery-close" onClick={closeTrailer}>Back to Discover</button></>}
  </main>
}
