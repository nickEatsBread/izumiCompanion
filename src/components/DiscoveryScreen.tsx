import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Play, Bookmark, ArrowRight, Info, Undo2, EyeOff, RefreshCw, ArrowLeft, ChevronLeft, ChevronRight, Sparkles, Star } from 'lucide-preact'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'
import type { CompanionReceiver, CompanionTrailerSource } from '../lib/receiver'
import { DISCOVERY_REMOTE, DISCOVERY_CHANGED, readDiscoveryChoices, persistDiscoveryChoice, discoveryChoiceMedia, tvDiscoveryDeck, discoveryKey, type DiscoveryChoice } from '../lib/discovery'
import { tvProfileId } from '../lib/profiles'
import { TrailerPlayer, TRAILER_CONTROL_EVENT } from './CatalogScreens'
import { DiscoveryArtwork, DiscoveryTitle } from './DiscoveryArtwork'
import { DISCOVERY_TILES, DISCOVERY_TILE_FOCUS, discoveryMediaFacts, discoveryRemoteFocus, discoverySynopsis, discoveryTrailer } from '../lib/discovery-navigation'
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
  const [openingTrailer, setOpeningTrailer] = useState(false)
  const trailerRequest = useRef(0)
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
  const videoId = discoveryTrailer(media)
  const selectedIndex = current ? deck.indexOf(current) : 0
  const firstTile = Math.floor(selectedIndex / DISCOVERY_TILES) * DISCOVERY_TILES
  const tiles = deck.slice(firstTile, firstTile + DISCOVERY_TILES)
  const actions = [
    { label: openingTrailer ? 'Opening trailer…' : videoId ? 'Watch trailer' : enriching ? 'Finding trailer…' : 'Trailer unavailable', Icon: Play, disabled: !videoId || openingTrailer },
    { label: 'Full details', Icon: Info, disabled: !media },
    { label: 'Save to My List', Icon: Bookmark, disabled: !media },
    { label: 'Skip for now', Icon: ArrowRight, disabled: !media },
    { label: 'Not for me', Icon: EyeOff, disabled: !media },
    { label: 'Undo last', Icon: Undo2, disabled: !last },
    { label: busy ? 'Loading…' : 'Refresh picks', Icon: RefreshCw, disabled: busy },
    { label: 'My List', Icon: ArrowLeft, disabled: false },
    { label: 'Previous picks', Icon: ChevronLeft, disabled: firstTile === 0 },
    { label: 'Next picks', Icon: ChevronRight, disabled: firstTile + DISCOVERY_TILES >= deck.length },
  ]
  function closeTrailer() {
    trailerRequest.current += 1
    setOpeningTrailer(false)
    const source = trailerRef.current
    trailerRef.current = null
    setTrailer(null)
    if (source) receiver?.releaseTrailer(source.requestId)
  }
  function selectPick(index: number, enterActions = false) {
    const pick = deck[index]
    if (!pick) return
    if (pick.key !== current?.key) closeTrailer()
    setRestored(pick.key)
    setFocus(enterActions ? 1 : DISCOVERY_TILE_FOCUS + index)
    setNotice(`Exploring ${pick.media.title}. Pick ${index + 1} of ${deck.length}.`)
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
    if (index >= DISCOVERY_TILE_FOCUS) return selectPick(index - DISCOVERY_TILE_FOCUS, true)
    if (actions[index]?.disabled) return
    if (index === 8 || index === 9) return selectPick(index === 8 ? firstTile - DISCOVERY_TILES : firstTile + DISCOVERY_TILES)
    if (index === 7) return onBack()
    if (index === 6) return refresh()
    if (index === 1 && media) return onDetails(media)
    if (index === 0 && videoId && media) {
      const openingKey = current?.key, openingProfile = tvProfileId()
      const request = ++trailerRequest.current
      setOpeningTrailer(true)
      setNotice('Opening trailer…')
      try {
        const source = await receiver?.requestTrailer(videoId, media.title)
        if (source && alive.current && request === trailerRequest.current && currentKey.current === openingKey && tvProfileId() === openingProfile) { trailerRef.current = source; setTrailer(source); setNotice('') }
        else if (source) receiver?.releaseTrailer(source.requestId)
        else setNotice('Connect this TV to play a trailer.')
      } catch { if (alive.current && request === trailerRequest.current) setNotice('The trailer couldn’t open. Try again or explore another title.') }
      finally { if (alive.current && request === trailerRequest.current) setOpeningTrailer(false) }
      return
    }
    const target = index === 5 ? last : media
    if (!target) return
    const action = index === 5 ? 'undo' : index === 2 ? 'save' : index === 3 ? 'skip' : 'dismiss'
    const choice: DiscoveryChoice = { profileId: tvProfileId(), media: discoveryChoiceMedia(target), action, at: Date.now(), pending: true }
    try { persistDiscoveryChoice(choice) }
    catch { setNotice('TV storage is full. This choice wasn’t saved.'); return }
    closeTrailer()
    setRestored(action === 'undo' ? discoveryKey(target) : '')
    setLast(action === 'undo' ? null : target)
    setNotice(action === 'undo' ? 'Last choice undone.' : action === 'skip' ? 'Skipped for seven days.' : action === 'save' ? 'Saved to My List on this TV.' : 'Choice saved. Personalized picks update when the main client syncs.')
    try {
      if (await receiver?.sendDiscoveryChoice(choice)) {
        if (alive.current && tvProfileId() === choice.profileId) persistDiscoveryChoice({ ...choice, pending: false })
      } else if (alive.current) setNotice('Saved on this TV. Cloud sync is pending; it will retry when connected.')
    } catch { if (alive.current) setNotice('Saved on this TV. Cloud sync will retry when connected.') }
  }
  useEffect(() => {
    alive.current = true
    const changed = () => setChoices(readDiscoveryChoices())
    window.addEventListener(DISCOVERY_CHANGED, changed)
    void refresh()
    const syncTimer = window.setInterval(() => { void receiver?.syncDiscoveryChoices().catch(() => {}) }, 30_000)
    return () => { alive.current = false; trailerRequest.current += 1; window.clearInterval(syncTimer); window.removeEventListener(DISCOVERY_CHANGED, changed); if (trailerRef.current) receiver?.releaseTrailer(trailerRef.current.requestId) }
  }, [receiver])
  useEffect(() => {
    let cancelled = false
    setDetails(null)
    if (!current || !receiver) { setEnriching(false); return }
    setEnriching(true)
    void receiver?.requestDetails(current.media).then(value => { if (!cancelled && value) setDetails({ ...current.media, ...value }) })
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
      if (openingTrailer && action === 'back') { closeTrailer(); setNotice('Trailer cancelled.'); return }
      if (action === 'back') return onBack()
      if (action === 'select') { void act(focus); return }
      const next = discoveryRemoteFocus(focus, action, actions.map(item => item.disabled), deck.length, selectedIndex)
      if (next !== focus) {
        if (next >= DISCOVERY_TILE_FOCUS) selectPick(next - DISCOVERY_TILE_FOCUS)
        else setFocus(next)
      }
    }
    window.addEventListener(DISCOVERY_REMOTE, remote)
    return () => window.removeEventListener(DISCOVERY_REMOTE, remote)
  })
  useLayoutEffect(() => {
    if (!current && focus !== 6 && focus !== 7) setFocus(7)
    else if (focus >= DISCOVERY_TILE_FOCUS && focus - DISCOVERY_TILE_FOCUS !== selectedIndex) setFocus(DISCOVERY_TILE_FOCUS + selectedIndex)
    else if (focus < DISCOVERY_TILE_FOCUS && actions[focus]?.disabled && !openingTrailer) setFocus(media ? 1 : 7)
  }, [current?.key, focus, selectedIndex, videoId, busy, openingTrailer, last])
  useLayoutEffect(() => { document.querySelector<HTMLButtonElement>(trailer ? '.tv-discovery-close' : '.tv-discovery .discovery-focused')?.focus() }, [focus, current?.key, trailer])
  return <main class={`tv-discovery${trailer ? ' has-trailer-open' : ''}`}>
    <div class="tv-discovery-browse" aria-hidden={trailer ? 'true' : undefined}>
      {media && <DiscoveryArtwork media={media} hero />}
      <div class="tv-discovery-shade" />
      <header class="tv-discovery-header"><div><h2>Discover</h2><p>Your next great watch starts here.</p></div><small>{current ? `Pick ${selectedIndex + 1} of ${deck.length}` : 'Your discovery queue'}</small></header>
      <div class="tv-discovery-content">
        <div class="tv-discovery-info">
          {media ? <>
            <p class="tv-discovery-eyebrow"><Sparkles size={18} />{current?.exploration ? 'Beyond your usual' : 'Picked for you'}</p>
            <DiscoveryTitle media={media} />
            <p class="tv-discovery-meta">{discoveryMediaFacts(media, true).join(' · ')}</p>
            <p class="tv-discovery-genres">{media.ratings?.[0] && <span class="tv-discovery-rating"><Star size={18} fill="currentColor" /> {media.ratings[0].score}/{media.ratings[0].scale} · {media.ratings[0].source}{!!media.genres?.length && <span aria-hidden="true"> · </span>}</span>}{media.genres?.slice(0, 3).join(' · ')}</p>
            <p class="tv-discovery-description">{discoverySynopsis(media.description) || (enriching ? 'Finding the story behind this pick…' : 'No synopsis is available. Open full details to explore this title.')}</p>
          </> : <><h1>You’re caught up</h1><p class="tv-discovery-description">Refresh your catalogs for more titles, or return to My List. Skipped picks return after seven days.</p></>}
        </div>
        {current && <section class="tv-discovery-why"><h2><Sparkles size={19} /> Why this pick</h2><strong>{current.reason}</strong><p>{current.evidence.slice(0, 2).join(' ')}</p></section>}
      </div>
      <div class="tv-discovery-actions" aria-label="Actions for this title">{actions.slice(0, 8).map(({ label, Icon, disabled }, index) => <button key={index} type="button" disabled={disabled} class={`${focus === index ? 'discovery-focused ' : ''}${index === 0 ? 'is-trailer-action' : ''}`} onFocus={() => setFocus(index)} onMouseEnter={() => !disabled && setFocus(index)} onClick={() => void act(index)}><Icon size={23} />{label}</button>)}</div>
      {deck.length > 0 && <section class="tv-discovery-rail" aria-label="More to discover">
        <div class="tv-discovery-rail-heading"><h2>More to discover <small>Use ← → to explore · OK for actions</small></h2><div class="tv-discovery-paging"><span>{firstTile + 1}–{Math.min(firstTile + DISCOVERY_TILES, deck.length)} of {deck.length}</span>{actions.slice(8).map(({ label, Icon, disabled }, pageIndex) => <button key={label} type="button" aria-label={label} disabled={disabled} class={focus === 8 + pageIndex ? 'discovery-focused' : ''} onFocus={() => setFocus(8 + pageIndex)} onClick={() => void act(8 + pageIndex)}><Icon size={24} /></button>)}</div></div>
        <ul class="tv-discovery-tiles">{tiles.map((pick, index) => {
          const position = firstTile + index
          const featured = pick.key === current?.key
          const item = featured && media ? media : pick.media
          return <li key={pick.key}><button type="button" aria-pressed={featured} aria-label={`Explore ${item.title}`} class={`tv-discovery-tile${featured ? ' is-featured' : ''}${focus === DISCOVERY_TILE_FOCUS + position ? ' discovery-focused' : ''}`} onFocus={() => { if (focus !== DISCOVERY_TILE_FOCUS + position) selectPick(position) }} onClick={() => selectPick(position, true)}>
            <DiscoveryArtwork media={item} />
            <span class="tv-discovery-tile-title">{item.title}</span>
            <span class="tv-discovery-tile-meta">{[...discoveryMediaFacts(item), ...item.genres?.slice(0, 1) ?? []].join(' · ')}</span>
          </button></li>
        })}</ul>
      </section>}
      <p class="tv-discovery-notice" role="status" aria-live="polite">{notice || 'Explore freely. Save a title to keep it in My List.'}</p>
    </div>
    {trailer && media && <><TrailerPlayer videoId={videoId} title={media.title} backdrop={media.backdrop} source={trailer.url} /><button class="tv-discovery-close" onClick={closeTrailer}>Back to Discover</button></>}
  </main>
}
