import {
  Bookmark,
  Captions,
  ChevronRight,
  Delete,
  Film,
  History,
  Link2Off,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Space,
  TrendingUp,
  Tv,
  UserRound,
  X,
} from 'lucide-preact'
import { memo } from 'preact/compat'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { CompanionMedia, CompanionPerson, FocusLocation } from '../types'
import { episodeCountsFor, episodeDetailsFor, seasonNumberFor } from '../lib/catalog'
import type { PlaybackExperienceSettings } from '../lib/playback-experience'
import { gridWindow, linearWindow } from '../lib/windowing'
import { NavRail } from './NavRail'

export type TrailerControlAction = 'toggle' | 'play' | 'pause' | 'seek-back' | 'seek-forward'
export const TRAILER_CONTROL_EVENT = 'izumi:trailer-control'

export type TrailerPlaybackState = 'buffering' | 'playing' | 'paused' | 'ended' | 'error'

/** YouTube's iframe API only starts emitting state events after this exact widget handshake. */
export const TRAILER_LISTENING_MESSAGE = { event: 'listening', id: 1, channel: 'widget' } as const
const YOUTUBE_PLAYER_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com']

export function trailerPlaybackState(value: unknown): TrailerPlaybackState | undefined {
  const state = Number(value && typeof value === 'object'
    ? (value as Record<string, unknown>).playerState
    : value)
  if (state === 1) return 'playing'
  if (state === 2) return 'paused'
  if (state === 0) return 'ended'
  if (state === -1 || state === 3 || state === 5) return 'buffering'
  return undefined
}

function trailerTime(value: number): string {
  const seconds = Math.max(0, Math.floor(value))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function TrailerPlayer({
  videoId,
  source,
  title,
  backdrop,
  onClose,
}: {
  videoId: string
  source: string
  title: string
  backdrop?: string
  onClose(): void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hitAreaRef = useRef<HTMLButtonElement>(null)
  const hideTimerRef = useRef<number>()
  const positionRef = useRef(0)
  const durationRef = useRef(0)
  const playbackRef = useRef<TrailerPlaybackState>('buffering')
  const readyRef = useRef(false)
  const captionsSuppressedAtRef = useRef(0)
  const [playback, setPlayback] = useState<TrailerPlaybackState>('buffering')
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [nativeCoverVisible, setNativeCoverVisible] = useState(true)
  const bridgeOrigin = useMemo(() => {
    try {
      const url = new URL(source)
      return url.hostname === 'www.youtube.com' || url.hostname === 'www.youtube-nocookie.com' ? '' : url.origin
    } catch { return '' }
  }, [source])

  const post = (payload: Record<string, unknown>) => {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    const serialized = JSON.stringify(payload)
    if (bridgeOrigin) target.postMessage({ type: 'izumi-youtube-command', payload: serialized }, bridgeOrigin)
    else target.postMessage(serialized, 'https://www.youtube-nocookie.com')
  }
  const send = (func: string, args: unknown[] = []) => post({ event: 'command', func, args })
  const enableAudio = () => {
    send('setVolume', [100])
    send('unMute')
  }
  const suppressCaptions = (force = false) => {
    const now = Date.now()
    if (!force && now - captionsSuppressedAtRef.current < 1_500) return
    captionsSuppressedAtRef.current = now
    send('setOption', ['captions', 'track', {}])
    send('unloadModule', ['captions'])
    send('unloadModule', ['cc'])
  }

  const applyPlayback = (next: TrailerPlaybackState) => {
    playbackRef.current = next
    setPlayback(next)
    if (next === 'playing') setNativeCoverVisible(false)
    else if (next === 'ended') setNativeCoverVisible(true)
  }

  const revealControls = (keepVisible = false) => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    setControlsVisible(true)
    if (!keepVisible) hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000)
  }

  const toggle = () => {
    if (playbackRef.current === 'playing') {
      send('pauseVideo')
      applyPlayback('paused')
      revealControls(true)
    } else {
      if (playbackRef.current === 'ended') send('seekTo', [0, true])
      enableAudio()
      send('playVideo')
      applyPlayback('buffering')
      revealControls(true)
    }
  }

  useEffect(() => {
    readyRef.current = false
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (bridgeOrigin && event.origin !== bridgeOrigin) return
      if (!bridgeOrigin && !YOUTUBE_PLAYER_ORIGINS.includes(event.origin)) return
      let raw = event.data
      if (bridgeOrigin) {
        if (!raw || raw.type !== 'izumi-youtube-event' || typeof raw.payload !== 'string') return
        raw = raw.payload
      }
      let payload: { event?: string; info?: unknown; data?: unknown }
      try { payload = typeof raw === 'string' ? JSON.parse(raw) : raw }
      catch { return }
      if (!payload || typeof payload !== 'object') return
      const info = payload.info && typeof payload.info === 'object' ? payload.info as Record<string, unknown> : undefined
      const firstReadyEvent = payload.event === 'onReady' || payload.event === 'initialDelivery' || payload.event === 'infoDelivery'
      if (firstReadyEvent && !readyRef.current) {
        readyRef.current = true
        suppressCaptions(true)
        enableAudio()
        send('playVideo')
        // The bridge can deliver readiness before a reliable onStateChange. Once playback has
        // been requested, uncover the real player instead of leaving the title-page artwork over it.
        window.setTimeout(() => setNativeCoverVisible(false), 500)
      }
      if (payload.event === 'onApiChange') suppressCaptions(true)
      if (payload.event === 'onStateChange') {
        const state = trailerPlaybackState(payload.info ?? payload.data)
        if (state) {
          if (state === 'playing') suppressCaptions()
          applyPlayback(state)
        }
      }
      if (payload.event === 'onError') applyPlayback('error')
      if (payload.event === 'onAutoplayBlocked') applyPlayback('paused')
      if (payload.event === 'initialDelivery' && info?.videoData && typeof info.videoData === 'object'
        && (info.videoData as Record<string, unknown>).isPlayable === false) applyPlayback('error')
      if (payload.event === 'infoDelivery' && info) {
        const nextPosition = Number(info.currentTime)
        const nextDuration = Number(info.duration)
        const nextState = trailerPlaybackState(info.playerState)
        if (Number.isFinite(nextPosition)) {
          positionRef.current = nextPosition
          setPosition(nextPosition)
        }
        if (Number.isFinite(nextDuration) && nextDuration > 0) {
          durationRef.current = nextDuration
          setDuration(nextDuration)
        }
        if (nextState) {
          if (nextState === 'playing') suppressCaptions()
          applyPlayback(nextState)
        }
      }
    }
    window.addEventListener('message', onMessage)
    post(TRAILER_LISTENING_MESSAGE)
    const connect = window.setInterval(() => {
      if (readyRef.current) return
      post(TRAILER_LISTENING_MESSAGE)
    }, 150)
    const poll = window.setInterval(() => {
      send('getCurrentTime')
      send('getDuration')
      send('getPlayerState')
    }, 500)
    const watchdog = window.setTimeout(() => {
      if (!readyRef.current) applyPlayback('error')
    }, 12000)
    return () => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(connect)
      window.clearInterval(poll)
      window.clearTimeout(watchdog)
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current)
    }
  }, [videoId, bridgeOrigin])

  useEffect(() => {
    const onControl = (event: Event) => {
      const action = (event as CustomEvent<TrailerControlAction>).detail
      revealControls(action === 'pause')
      if (action === 'toggle') toggle()
      else if (action === 'play') {
        enableAudio()
        send('playVideo')
        applyPlayback('buffering')
      } else if (action === 'pause') {
        send('pauseVideo')
        applyPlayback('paused')
      } else {
        const offset = action === 'seek-back' ? -10 : 10
        const target = Math.max(0, Math.min(durationRef.current || Number.POSITIVE_INFINITY, positionRef.current + offset))
        positionRef.current = target
        setPosition(target)
        send('seekTo', [target, true])
      }
    }
    window.addEventListener(TRAILER_CONTROL_EVENT, onControl)
    hitAreaRef.current?.focus()
    return () => window.removeEventListener(TRAILER_CONTROL_EVENT, onControl)
  }, [])

  useEffect(() => {
    if (playback === 'playing') revealControls()
    else revealControls(true)
  }, [playback])

  const progress = duration ? Math.min(100, position / duration * 100) : 0
  const status = playback === 'paused' ? 'Paused' : playback === 'ended' ? 'Trailer ended' : playback === 'error' ? 'Trailer unavailable' : playback === 'buffering' ? 'Loading trailer' : 'Trailer'

  return (
    <section class="series-trailer-overlay" role="dialog" aria-modal="true" aria-label={`${title} trailer`}>
      <iframe
        ref={iframeRef}
        src={source}
        title={`${title} trailer`}
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
        onLoad={() => {
          post(TRAILER_LISTENING_MESSAGE)
          window.setTimeout(() => {
            suppressCaptions(true)
            enableAudio()
            send('playVideo')
          }, 350)
        }}
      />
      <button ref={hitAreaRef} class="series-trailer-hit-area" type="button" tabIndex={-1} aria-label={playback === 'playing' ? 'Pause trailer' : 'Play trailer'} onClick={toggle} />
      <div class={`series-trailer-youtube-mask${playback === 'playing' ? '' : ' is-active'}`} />
      <div class={`series-trailer-native-cover${nativeCoverVisible ? ' is-visible' : ''}`} style={backdrop ? { backgroundImage: `url("${backdrop.replace(/"/g, '%22')}")` } : undefined}>
        <span><Play size={32} fill="currentColor" /></span>
      </div>
      <div class={`series-trailer-center-control${playback === 'paused' || playback === 'ended' || playback === 'error' ? ' is-visible' : ''}`}>
        <Play size={32} fill="currentColor" />
      </div>
      <div class={`series-trailer-hud${controlsVisible ? ' is-visible' : ''}`}>
        <header>
          <span class="series-trailer-state">
            {playback === 'playing' ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </span>
          <div><p>{status}</p><h2>{title}</h2></div>
        </header>
        <div class="series-trailer-progress"><i style={{ width: `${progress}%` }} /></div>
        <div class="series-trailer-times"><span>{trailerTime(position)}</span><span>{duration ? trailerTime(duration) : '--:--'}</span></div>
      </div>
      <button class="series-trailer-close" type="button" onClick={onClose} aria-label="Back to series">
        <X size={22} /> Back to series
      </button>
    </section>
  )
}

export interface SearchKeyDefinition {
  value: string
  row: number
  column: number
  span: number
}

const searchKey = (value: string, row: number, column: number, span = 1): SearchKeyDefinition => ({
  value,
  row,
  column,
  span,
})

/** A compact six-column layout keeps D-pad moves short without taking space from results.
 * The action row also provides an explicit route into Samsung's native input/voice UI. */
export const SEARCH_KEYS: SearchKeyDefinition[] = [
  ...[...'abcdefghijklmnopqrstuvwxyz1234567890'].map((value, index) => (
    searchKey(value, 1 + Math.floor(index / 6), index % 6)
  )),
  searchKey('SPACE', 0, 0, 2),
  searchKey('DELETE', 0, 2, 2),
  searchKey('VOICE', 0, 4, 2),
]

export const SEARCH_KEY_LAST_ROW = Math.max(...SEARCH_KEYS.map((key) => key.row))
export const SEARCH_VOICE_KEY_INDEX = SEARCH_KEYS.findIndex((key) => key.value === 'VOICE')

export function adjacentSearchKey(
  index: number,
  direction: 'left' | 'right' | 'up' | 'down',
  preferredColumn?: number,
): number | undefined {
  const current = SEARCH_KEYS[index]
  if (!current) return undefined
  if (direction === 'left' || direction === 'right') {
    const sameRow = SEARCH_KEYS
      .map((key, keyIndex) => ({ key, keyIndex }))
      .filter(({ key }) => key.row === current.row)
      .sort((left, right) => left.key.column - right.key.column)
    const position = sameRow.findIndex(({ keyIndex }) => keyIndex === index)
    return sameRow[position + (direction === 'left' ? -1 : 1)]?.keyIndex
  }
  const targetRow = current.row + (direction === 'up' ? -1 : 1)
  const column = preferredColumn ?? current.column
  return SEARCH_KEYS
    .map((key, keyIndex) => ({ key, keyIndex }))
    .filter(({ key }) => key.row === targetRow)
    .sort((left, right) => (
      searchColumnDistance(left.key, column)
      - searchColumnDistance(right.key, column)
      || left.key.column - right.key.column
    ))[0]?.keyIndex
}

function searchColumnDistance(key: SearchKeyDefinition, column: number): number {
  if (column < key.column) return key.column - column
  const rightColumn = key.column + key.span - 1
  return column > rightColumn ? column - rightColumn : 0
}

export function nearestSearchKey(row: number, column: number): number {
  return SEARCH_KEYS
    .map((key, keyIndex) => ({ key, keyIndex }))
    .filter(({ key }) => key.row === Math.max(0, Math.min(SEARCH_KEY_LAST_ROW, row)))
    .sort((left, right) => (
      Math.abs(left.key.column + left.key.span / 2 - column)
      - Math.abs(right.key.column + right.key.span / 2 - column)
    ))[0]?.keyIndex ?? 0
}

function eventIndex(event: Event, attribute: string): number | undefined {
  if (!(event.target instanceof Element) || !(event.currentTarget instanceof Element)) return undefined
  const target = event.target.closest<HTMLElement>(`[${attribute}]`)
  if (!target || !event.currentTarget.contains(target)) return undefined
  const index = Number(target.getAttribute(attribute))
  return Number.isInteger(index) && index >= 0 ? index : undefined
}

const MediaTile = memo(function MediaTile({
  item,
  index,
  focused,
}: {
  item: CompanionMedia
  index: number
  focused: boolean
}) {
  return (
    <button
      type="button"
      class={`browse-card${focused ? ' is-focused' : ''}`}
      data-focus-id={`grid-${index}`}
      data-grid-index={index}
      tabIndex={focused ? 0 : -1}
      aria-label={item.title}
    >
      {item.poster ? <img src={item.poster} alt="" /> : <span>{item.title}</span>}
      <span class="browse-card-shade" />
      <strong>{item.title}</strong>
      {item.placement?.position && <small>#{item.placement.position}</small>}
    </button>
  )
})

function GridRowSpacers({ count, search = false }: { count: number; search?: boolean }) {
  return <>{Array.from({ length: count }, (_, index) => (
    <span class={`grid-row-spacer${search ? ' is-search' : ''}`} aria-hidden="true" key={index} />
  ))}</>
}

const catalogIcons = {
  trending: TrendingUp,
  series: Tv,
  movies: Film,
  'my-list': Bookmark,
}

export function CatalogScreen({
  mode,
  title,
  description,
  items,
  selected,
  focus,
  activeNav,
  onNav,
  onNavFocus,
  onFocus,
  onSelect,
}: {
  mode: keyof typeof catalogIcons
  title: string
  description: string
  items: CompanionMedia[]
  selected: CompanionMedia
  focus: FocusLocation
  activeNav: number
  onNav(index: number): void
  onNavFocus(index: number): void
  onFocus(index: number): void
  onSelect(media: CompanionMedia): void
}) {
  const Icon = catalogIcons[mode]
  const isEmpty = items.length === 0
  const contextualPlacement = mode === 'trending' || mode === 'my-list' ? selected.placement : undefined
  const focusIndex = focus.zone === 'grid' ? focus.index : 0
  const itemWindow = gridWindow(items.length, focusIndex, 6, 1)
  const reason = contextualPlacement
    ? `${contextualPlacement.position ? `#${contextualPlacement.position} in ` : ''}${contextualPlacement.label}`
    : mode === 'series' ? 'Series selected for your catalog' : mode === 'movies' ? 'Feature films' : title
  return (
    <main class="browse-screen">
      <NavRail
        activeIndex={activeNav}
        focus={focus}
        onFocus={onNavFocus}
        onSelect={onNav}
      />
      <div class={`browse-hero-art${isEmpty ? ' is-empty' : ''}`} key={`${selected.ref.provider}-${selected.ref.id}`}>
        {(selected.backdrop || selected.poster) && <img src={selected.backdrop || selected.poster} alt="" />}
        <span />
      </div>
      <header class="browse-heading">
        <p><Icon size={19} /> {isEmpty ? title : reason}</p>
        <h1>{isEmpty ? title : selected.title}</h1>
        <span>{isEmpty
          ? mode === 'movies'
            ? 'No films were supplied by this catalogue.'
            : mode === 'my-list'
              ? 'Titles you save in izumi will appear here.'
              : 'This catalogue has no titles for this section yet.'
          : selected.subtitle || description}</span>
      </header>
      <section class="browse-catalog" aria-label={title}>
        <div class="browse-title-row">
          <div><p>{mode === 'my-list' ? 'Your library' : 'Browse'}</p><h2>{title}</h2></div>
          <span>{items.length} titles</span>
        </div>
        {items.length ? <div
          class="browse-grid"
          onFocusCapture={(event) => {
            const index = eventIndex(event, 'data-grid-index')
            if (index !== undefined) onFocus(index)
          }}
          onMouseOver={(event) => {
            const index = eventIndex(event, 'data-grid-index')
            if (index !== undefined) onFocus(index)
          }}
          onClick={(event) => {
            const index = eventIndex(event, 'data-grid-index')
            const item = index === undefined ? undefined : items[index]
            if (item) onSelect(item)
          }}
        >
          <GridRowSpacers count={itemWindow.leadingRows} />
          {items.slice(itemWindow.start, itemWindow.end).map((item, offset) => {
            const index = itemWindow.start + offset
            return <MediaTile
                item={item}
                index={index}
                focused={focus.zone === 'grid' && focus.index === index}
                key={`${item.ref.provider}-${item.ref.id}`}
              />
          })}
          <GridRowSpacers count={itemWindow.trailingRows} />
        </div> : (
          <div class="catalog-empty" role="status">
            <Icon size={34} strokeWidth={1.6} />
            <strong>{mode === 'my-list' ? 'Your list is empty' : `No ${title.toLowerCase()} available`}</strong>
            <span>Open izumi on your paired device to update this catalogue.</span>
          </div>
        )}
      </section>
    </main>
  )
}

function relationLabel(value: string): string {
  const labels: Record<string, string> = {
    SEQUEL: 'Next season',
    PREQUEL: 'Earlier story',
    PARENT: 'Main series',
    SIDE_STORY: 'Side story',
    SPIN_OFF: 'Spin-off',
    ALTERNATIVE: 'Alternate version',
    SUMMARY: 'Recap',
  }
  return labels[value] ?? value.replace(/_/g, ' ').toLowerCase().replace(/^./, (letter: string) => letter.toUpperCase())
}

export type SeriesOverviewAction = 'play' | 'episodes' | 'trailer' | 'relations'

export function youtubeTrailerId(media: CompanionMedia): string | undefined {
  const raw = media.trailer?.id?.trim()
  if (!raw || (media.trailer?.site && media.trailer.site.toLowerCase() !== 'youtube')) return undefined
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw
  try {
    const url = new URL(raw)
    const id = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop()
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined
  } catch { return undefined }
}

export function seriesOverviewActionsFor(media: CompanionMedia): SeriesOverviewAction[] {
  const actions: SeriesOverviewAction[] = ['play']
  if (episodeCountsFor(media).length) actions.push('episodes')
  actions.push('trailer')
  if (media.relations?.length) actions.push('relations')
  return actions
}

export type DetailAction = 'play' | 'trailer' | 'close'

export function detailActionsFor(_media: CompanionMedia): DetailAction[] {
  return ['play', 'trailer', 'close']
}

export function contributorsFor(media: CompanionMedia): CompanionPerson[] {
  const unique = new Map<string, CompanionPerson>()
  ;[...(media.cast ?? []), ...(media.crew ?? [])].forEach((person) => {
    const key = `${person.provider}:${person.id}`
    if (!unique.has(key)) unique.set(key, person)
  })
  return [...unique.values()].slice(0, 24)
}

function ContributorBrowser({ media, focus, onFocus, onSelect }: {
  media: CompanionMedia
  focus: FocusLocation
  onFocus(index: number): void
  onSelect(person: CompanionPerson): void
}) {
  const contributors = contributorsFor(media)
  const window = linearWindow(contributors.length, focus.zone === 'person' ? focus.index : 0, 6)
  return <section class="contributor-browser" aria-label={`Cast and crew for ${media.title}`}>
    <header><div><p>Cast &amp; Crew</p><h2>People behind {media.title}</h2></div><span>{contributors.length} profiles</span></header>
    <div class="contributor-strip">
      {contributors.slice(window.start, window.end).map((person, offset) => {
        const index = window.start + offset
        const focused = focus.zone === 'person' && focus.index === index
        return <button
          type="button"
          class={focused ? 'is-focused' : ''}
          data-focus-id={`person-${index}`}
          tabIndex={focused ? 0 : -1}
          onFocus={() => onFocus(index)}
          onMouseEnter={() => onFocus(index)}
          onClick={() => onSelect(person)}
          key={`${person.provider}-${person.id}-${person.credit}`}
        >
          <span class="contributor-portrait">{person.image ? <img src={person.image} alt="" /> : <UserRound size={42} strokeWidth={1.3} />}</span>
          <span class="contributor-copy"><strong>{person.name}</strong><small>{person.role || (person.credit === 'cast' ? 'Cast' : 'Crew')}</small></span>
        </button>
      })}
    </div>
    <p class="contributor-hint"><Search size={17} /> Select a person to browse their films and series</p>
  </section>
}

export function SeriesScreen({
  selected,
  hideSpoilers,
  season,
  focus,
  onSeriesActionFocus,
  onSeriesAction,
  onSeasonFocus,
  onSeasonSelect,
  onEpisodeFocus,
  onEpisodePlay,
  onRelationFocus,
  onRelationSelect,
  onPersonFocus,
  onPersonSelect,
  trailerOpen,
  trailerSource,
  trailerError,
  onTrailerClose,
}: {
  selected: CompanionMedia
  hideSpoilers: boolean
  season: number
  focus: FocusLocation
  onSeriesActionFocus(index: number): void
  onSeriesAction(action: SeriesOverviewAction): void
  onSeasonFocus(index: number): void
  onSeasonSelect(index: number): void
  onEpisodeFocus(index: number): void
  onEpisodePlay(index: number): void
  onRelationFocus(index: number): void
  onRelationSelect(media: CompanionMedia): void
  onPersonFocus(index: number): void
  onPersonSelect(person: CompanionPerson): void
  trailerOpen: boolean
  trailerSource?: string
  trailerError?: string
  onTrailerClose(): void
}) {
  const seasonCounts = useMemo(() => episodeCountsFor(selected), [selected])
  const hasEpisodeMetadata = seasonCounts.length > 0
  const activeSeason = hasEpisodeMetadata ? Math.min(season, seasonCounts.length - 1) : 0
  const seasonNumber = hasEpisodeMetadata ? seasonNumberFor(selected, activeSeason, seasonCounts) : selected.season ?? 1
  const episodes = useMemo(
    () => hasEpisodeMetadata ? episodeDetailsFor(selected, activeSeason, seasonCounts) : [],
    [selected, activeSeason, seasonCounts, hasEpisodeMetadata],
  )
  const resumeSeason = selected.season ?? 1
  const resumeEpisode = resumeSeason === seasonNumber && selected.episode ? selected.episode : -1
  const relations = selected.relations ?? []
  const contributors = contributorsFor(selected)
  const episodeFocus = focus.zone === 'episode' ? focus.index : 0
  const episodeWindow = linearWindow(episodes.length, episodeFocus, 4)
  const trailerId = youtubeTrailerId(selected)
  const overviewActions = seriesOverviewActionsFor(selected)
  const view = focus.zone === 'series-season' || focus.zone === 'episode'
    ? 'episodes'
    : focus.zone === 'relation'
      ? 'relations'
      : focus.zone === 'person'
        ? 'people'
      : 'overview'
  const subtitleParts = (selected.subtitle ?? '').split(/\s*[·•]\s*/).map((part) => part.trim()).filter(Boolean)
  const year = subtitleParts.find((part) => /^(?:19|20)\d{2}$/.test(part))
  const descriptors = subtitleParts.filter((part) => part !== year && !/\bepisodes?\b/i.test(part))
  const seasonLabel = seasonCounts.length === 1 ? '1 Season' : seasonCounts.length > 1 ? `${seasonCounts.length} Seasons` : undefined

  const titleBlock = (
    <header class={`series-title-block${selected.title.length > 22 ? ' is-long-title' : ''}`}>
      <h1>{selected.title}</h1>
      <div class="series-meta">
        {year && <span>{year}</span>}
        {selected.contentRating && <strong>{selected.contentRating}</strong>}
        {seasonLabel && <span>{seasonLabel}</span>}
        {!year && !seasonLabel && selected.subtitle && <span>{selected.subtitle}</span>}
      </div>
    </header>
  )

  return (
    <main class={`browse-screen series-screen is-${view}${trailerOpen ? ' has-trailer-open' : ''}`}>
      <div class="browse-hero-art series-hero-art" key={`${selected.ref.provider}-${selected.ref.id}`}>
        {(selected.backdrop || selected.poster) && <img src={selected.backdrop || selected.poster} alt={`${selected.title} backdrop`} />}
        <span />
      </div>
      {titleBlock}

      {view === 'overview' && <section class="series-overview">
        <p class="series-summary">{selected.description || 'Choose a season and episode to start watching.'}</p>
        {descriptors.length > 0 && <p class="series-descriptors">{descriptors.join(', ')}</p>}
        <div class="series-action-list" aria-label={`${selected.title} options`}>
          {overviewActions.map((action, index) => {
            const focused = focus.zone === 'series-action' && focus.index === index
            const label = action === 'play'
              ? `Play Season ${resumeSeason}: Episode ${resumeEpisode > 0 ? resumeEpisode : 1}`
              : action === 'episodes'
                ? 'More Episodes'
                : action === 'trailer'
                  ? 'Play Trailer'
                  : 'More in This Franchise'
            const Icon = action === 'play' ? Play : action === 'episodes' ? Tv : action === 'trailer' ? Film : Bookmark
            return <button
              type="button"
              class={`series-action${focused ? ' is-focused' : ''}`}
              data-focus-id={`series-action-${index}`}
              tabIndex={focused ? 0 : -1}
              onFocus={() => onSeriesActionFocus(index)}
              onMouseEnter={() => onSeriesActionFocus(index)}
              onClick={() => onSeriesAction(action)}
              key={action}
            >
              <Icon size={24} fill={action === 'play' ? 'currentColor' : 'none'} />
              <span>{label}</span>
            </button>
          })}
        </div>
        {contributors.length > 0 && <p class="contributor-entry-hint"><UserRound size={18} /> Down for Cast &amp; Crew</p>}
      </section>}

      {view === 'episodes' && <section class="series-library" aria-label={`${selected.title} episodes`}>
        <aside class="season-options" aria-label="Choose season">
          {hasEpisodeMetadata && <div>
            {seasonCounts.map((count, index) => (
              <button
                type="button"
                class={`${index === activeSeason ? 'is-selected' : ''}${focus.zone === 'series-season' && focus.index === index ? ' is-focused' : ''}`}
                data-focus-id={`series-season-${index}`}
                tabIndex={focus.zone === 'series-season' && focus.index === index ? 0 : -1}
                aria-label={`Season ${index + 1}, ${count} episodes`}
                onFocus={() => onSeasonFocus(index)}
                onMouseEnter={() => onSeasonFocus(index)}
                onClick={() => onSeasonSelect(index)}
                key={`${selected.ref.id}-season-${index}`}
              >
                <span>{selected.seasonLabels?.[index] ?? `Season ${index + 1}`}</span>
                <small>{count} episodes</small>
              </button>
            ))}
          </div>}
        </aside>

        <div class="series-library-scroll">
          {episodes.length ? <div class="series-episode-list">
          {episodeWindow.start > 0 && <span class="series-episode-window-spacer" style={{ height: `${episodeWindow.start * 25.75}vh` }} aria-hidden="true" />}
          {episodes.slice(episodeWindow.start, episodeWindow.end).map((episode, offset) => {
            const index = episodeWindow.start + offset
            const focused = focus.zone === 'episode' && focus.index === index
            const current = seasonNumber === resumeSeason && episode.episode === resumeEpisode
            const watched = episode.watched ?? (seasonNumber === resumeSeason && episode.episode < resumeEpisode)
            const progress = episode.progress ?? (current ? selected.episodeProgress : watched ? 1 : 0)
            const spoiler = hideSpoilers && (episode.spoiler ?? !watched)
            const title = spoiler
              ? `Episode ${episode.episode}`
              : current && selected.episodeTitle ? selected.episodeTitle : episode.title || `Episode ${episode.episode}`
            return (
              <button
                type="button"
                class={`series-episode${focused ? ' is-focused' : ''}${current ? ' is-current' : ''}${spoiler ? ' is-spoiler' : ''}`}
                data-focus-id={`episode-${index}`}
                tabIndex={focused ? 0 : -1}
                aria-label={`Play ${selected.title}, season ${seasonNumber}, episode ${episode.episode}, ${title}`}
                onFocus={() => onEpisodeFocus(index)}
                onMouseEnter={() => onEpisodeFocus(index)}
                onClick={() => onEpisodePlay(index)}
                key={`${selected.ref.id}-${seasonNumber}-${episode.episode}`}
              >
                <span class="series-episode-art">
                  {(episode.image || selected.backdrop || selected.poster) && <img src={episode.image || selected.backdrop || selected.poster} alt={`${selected.title}, season ${seasonNumber}, episode ${episode.episode}`} />}
                  <strong>S{seasonNumber}: E{episode.episode}</strong>
                  {typeof progress === 'number' && progress > 0 && <span><i style={{ width: `${Math.round(progress * 100)}%` }} /></span>}
                </span>
                <span class="series-episode-copy">
                  <strong>“{title}”</strong>
                  {spoiler ? <p>Episode details hidden to avoid spoilers.</p> : episode.description && <p>{episode.description}</p>}
                  <em>{episode.runtimeMinutes ? `(${episode.runtimeMinutes}m)` : current ? 'Continue watching' : watched ? 'Watched' : ''}</em>
                </span>
              </button>
            )
          })}
          {episodeWindow.end < episodes.length && <span class="series-episode-window-spacer" style={{ height: `${(episodes.length - episodeWindow.end) * 25.75}vh` }} aria-hidden="true" />}
          </div> : (
            <div class="series-episodes-empty" role="status">
              <Tv size={30} strokeWidth={1.6} />
              <strong>Episode information isn’t available</strong>
              <span>Refresh this title from izumi to send its seasons and episodes to the TV.</span>
            </div>
          )}
        </div>
      </section>}

      {view === 'relations' && <section class="series-relations-browser" aria-label={`Titles related to ${selected.title}`}>
        <aside><strong>Related Titles</strong><small>{relations.length} available</small></aside>
        <div class="series-relation-list">
          {relations.map((relation, index) => {
            const relationMedia = relation.media
            const focused = focus.zone === 'relation' && focus.index === index
            return <button
              type="button"
              class={`series-relation-row${focused ? ' is-focused' : ''}`}
              data-focus-id={`relation-${index}`}
              tabIndex={focused ? 0 : -1}
              onFocus={() => onRelationFocus(index)}
              onMouseEnter={() => onRelationFocus(index)}
              onClick={() => onRelationSelect(relationMedia)}
              key={`${relation.relationType}-${relationMedia.ref.provider}-${relationMedia.ref.id}`}
            >
              <span>{(relationMedia.backdrop || relationMedia.poster) && <img src={relationMedia.backdrop || relationMedia.poster} alt={`${relationMedia.title} artwork`} />}</span>
              <span><small>{relationLabel(relation.relationType)}</small><strong>{relationMedia.title}</strong><p>{relationMedia.description || relationMedia.subtitle}</p></span>
            </button>
          })}
        </div>
      </section>}

      {view === 'people' && contributors.length > 0 && <ContributorBrowser
        media={selected}
        focus={focus}
        onFocus={onPersonFocus}
        onSelect={onPersonSelect}
      />}

      <div class="series-back-hint" aria-hidden="true"><i /> <span>Back</span></div>
      {trailerOpen && trailerId && (
        trailerSource
          ? <TrailerPlayer videoId={trailerId} source={trailerSource} title={selected.title} backdrop={selected.backdrop || selected.poster} onClose={onTrailerClose} />
          : <section class="series-trailer-overlay" role="dialog" aria-modal="true" aria-label={`${selected.title} trailer`}>
              <div class="series-trailer-native-cover is-visible" style={(selected.backdrop || selected.poster) ? { backgroundImage: `url("${(selected.backdrop || selected.poster)!.replace(/"/g, '%22')}")` } : undefined}>
                <span>{trailerError ? <X size={32} /> : <Film size={32} />}</span>
              </div>
              <div class="series-trailer-hud is-visible"><header><div><p>{trailerError ? 'Trailer unavailable' : 'Preparing trailer'}</p><h2>{trailerError || selected.title}</h2></div></header></div>
              <button class="series-trailer-close" type="button" onClick={onTrailerClose} aria-label="Back to series"><X size={22} /> Back to series</button>
            </section>
      )}
    </main>
  )
}

export function SearchScreen({
  query,
  suggestions,
  results,
  loading,
  error,
  focus,
  activeNav,
  onNav,
  onNavFocus,
  onKey,
  onKeyFocus,
  onSuggestion,
  onSuggestionFocus,
  onResultFocus,
  onResultSelect,
  onQueryChange,
  onQueryFocus,
  onQueryDone,
  resultTitle,
}: {
  query: string
  suggestions: string[]
  results: CompanionMedia[]
  loading: boolean
  error: string
  focus: FocusLocation
  activeNav: number
  onNav(index: number): void
  onNavFocus(index: number): void
  onKey(index: number): void
  onKeyFocus(index: number): void
  onSuggestion(index: number): void
  onSuggestionFocus(index: number): void
  onResultFocus(index: number): void
  onResultSelect(media: CompanionMedia): void
  onQueryChange(value: string): void
  onQueryFocus(): void
  onQueryDone(): void
  resultTitle?: string
}) {
  const resultWindow = gridWindow(results.length, focus.zone === 'grid' ? focus.index : 0, 4, 2)
  return (
    <main class="utility-screen search-screen">
      <NavRail activeIndex={activeNav} focus={focus} onFocus={onNavFocus} onSelect={onNav} />
      <div class="search-layout">
        <section class="search-entry" aria-label="Search entry">
          <div class="search-keyboard" aria-label="On-screen keyboard">
            {SEARCH_KEYS.map((key, index) => (
              <button
                type="button"
                class={`${focus.zone === 'keyboard' && focus.index === index ? 'is-focused' : ''}${key.span > 1 || key.value.length > 1 ? ' is-wide is-action' : ''}${key.span > 1 ? ` is-span-${key.span}` : ''}`}
                data-focus-id={`keyboard-${index}`}
                data-search-key={key.value.toLowerCase()}
                data-search-row={key.row}
                data-search-column={key.column}
                tabIndex={focus.zone === 'keyboard' && focus.index === index ? 0 : -1}
                aria-label={key.value === 'DELETE' ? 'Delete character' : key.value === 'SPACE' ? 'Space' : key.value === 'VOICE' ? 'Open keyboard and voice input' : key.value}
                onFocus={() => onKeyFocus(index)}
                onMouseEnter={() => onKeyFocus(index)}
                onClick={() => onKey(index)}
                style={{ gridColumn: `${key.column + 1} / span ${key.span}`, gridRow: key.row + 1, order: key.row }}
                key={key.value}
              >
                {key.value === 'DELETE'
                  ? <Delete size={21} />
                  : key.value === 'SPACE'
                    ? <Space size={22} />
                    : key.value === 'VOICE'
                      ? <><Mic size={21} /><span>Input</span></>
                      : key.value}
              </button>
            ))}
          </div>
          {suggestions.length > 0 && (
            <div class="search-suggestions" aria-label="Search suggestions" key={`suggestions-${query}`}>
              <p>{query ? 'Suggestions' : 'Popular searches'}</p>
              {suggestions.map((suggestion, index) => (
                <button
                  type="button"
                  class={focus.zone === 'suggestion' && focus.index === index ? 'is-focused' : ''}
                  data-focus-id={`suggestion-${index}`}
                  tabIndex={focus.zone === 'suggestion' && focus.index === index ? 0 : -1}
                  onFocus={() => onSuggestionFocus(index)}
                  onMouseEnter={() => onSuggestionFocus(index)}
                  onClick={() => onSuggestion(index)}
                  key={suggestion}
                >{suggestion}</button>
              ))}
            </div>
          )}
        </section>
        <section class="search-results" aria-live="polite" aria-busy={loading}>
          <header class="search-query-header">
            <label class={`search-query${query ? '' : ' is-empty'}${focus.zone === 'search-input' ? ' is-focused' : ''}`}>
              <Search size={28} strokeWidth={2.15} />
              <input
                type="text"
                value={query}
                maxLength={32}
                inputMode="search"
                autoComplete="off"
                spellcheck={false}
                placeholder="Search for a show, movie, person or genre"
                aria-label="Search titles"
                data-focus-id="search-input-0"
                tabIndex={focus.zone === 'search-input' ? 0 : -1}
                onFocus={onQueryFocus}
                onInput={(event) => onQueryChange((event.currentTarget as HTMLInputElement).value.slice(0, 32))}
                onKeyDown={(event) => {
                  const keyCode = (event as KeyboardEvent).keyCode
                  if (event.key === 'Enter' || event.key === 'Escape' || keyCode === 65376 || keyCode === 65385) {
                    event.currentTarget.blur()
                  }
                }}
                onBlur={() => {
                  if (focus.zone === 'search-input') onQueryDone()
                }}
              />
              <Mic class="search-query-voice" size={20} aria-hidden="true" />
            </label>
          </header>
          <div class="search-result-heading">
            <h2>{resultTitle || (query ? `Titles related to “${query}”` : 'Popular on izumi')}</h2>
            <span>{results.length} {results.length === 1 ? 'title' : 'titles'}</span>
          </div>
          {loading ? (
            <div class="search-result-grid search-result-loading" aria-label="Searching catalogue">
              {Array.from({ length: 10 }, (_, index) => <span class="search-result-skeleton" key={index} />)}
            </div>
          ) : error ? <div class="search-empty search-error" role="alert"><Search size={34} /><strong>Search unavailable</strong><span>{error}</span></div> : results.length ? (
            <div
              class="search-result-grid"
              key={`results-${query}`}
              onFocusCapture={(event) => {
                const index = eventIndex(event, 'data-grid-index')
                if (index !== undefined) onResultFocus(index)
              }}
              onMouseOver={(event) => {
                const index = eventIndex(event, 'data-grid-index')
                if (index !== undefined) onResultFocus(index)
              }}
              onClick={(event) => {
                const index = eventIndex(event, 'data-grid-index')
                const item = index === undefined ? undefined : results[index]
                if (item) onResultSelect(item)
              }}
            >
              <GridRowSpacers count={resultWindow.leadingRows} search />
              {results.slice(resultWindow.start, resultWindow.end).map((item, offset) => {
                const index = resultWindow.start + offset
                return <MediaTile
                    item={item}
                    index={index}
                    focused={focus.zone === 'grid' && focus.index === index}
                    key={`${item.ref.provider}-${item.ref.id}`}
                  />
              })}
              <GridRowSpacers count={resultWindow.trailingRows} search />
            </div>
          ) : <div class="search-empty" role="status"><Search size={34} /><strong>No matches found</strong><span>Try another title, person or genre.</span></div>}
        </section>
      </div>
    </main>
  )
}

export type SettingsConfirmation = 'unpair' | 'reset' | null

export function DetailScreen({
  media,
  focus,
  onFocus,
  onPlay,
  onTrailer,
  onClose,
  trailerOpen,
  trailerSource,
  trailerError,
  onTrailerClose,
  onPersonFocus,
  onPersonSelect,
}: {
  media: CompanionMedia
  focus: FocusLocation
  onFocus(index: number): void
  onPlay(media: CompanionMedia): void
  onTrailer(media: CompanionMedia): void
  onClose(): void
  trailerOpen: boolean
  trailerSource?: string
  trailerError?: string
  onTrailerClose(): void
  onPersonFocus(index: number): void
  onPersonSelect(person: CompanionPerson): void
}) {
  const reason = media.placement
    ? `${media.placement.position ? `#${media.placement.position} in ` : ''}${media.placement.label}`
    : 'Selected for you'
  const ReasonIcon = media.placement?.kind === 'continue' ? History : TrendingUp
  const trailerId = youtubeTrailerId(media)
  const actions = detailActionsFor(media)
  const contributors = contributorsFor(media)
  return (
    <main class={`detail-screen${focus.zone === 'person' ? ' is-people' : ''}${trailerOpen ? ' has-trailer-open' : ''}`}>
      <div class="detail-art" key={`${media.ref.provider}-${media.ref.id}`}>
        {(media.backdrop || media.poster) && <img src={media.backdrop || media.poster} alt="" />}
        <span />
      </div>
      <section class="detail-copy">
        <p class="detail-reason"><ReasonIcon size={19} /> {reason}</p>
        <h1>{media.title}</h1>
        <p class="detail-meta">{[media.subtitle, media.contentRating].filter(Boolean).join(' · ')}</p>
        <p class="detail-description">{media.description || 'Open this title to continue watching or start from the beginning.'}</p>
        <div class="detail-actions">
          {actions.map((action, index) => (
            <button
              type="button"
              class={focus.zone === 'detail' && focus.index === index ? 'is-focused' : ''}
              data-focus-id={`detail-${index}`}
              tabIndex={focus.zone === 'detail' && focus.index === index ? 0 : -1}
              onFocus={() => onFocus(index)}
              onMouseEnter={() => onFocus(index)}
              onClick={() => action === 'play' ? onPlay(media) : action === 'trailer' ? onTrailer(media) : onClose()}
              key={action}
            >
              {action === 'play'
                ? <><Play size={25} fill="currentColor" /> {media.progress ? 'Resume' : 'Play'}</>
                : action === 'trailer'
                  ? <><Film size={25} /> Play Trailer</>
                  : <><X size={25} /> Back to browse</>}
            </button>
          ))}
        </div>
        {contributors.length > 0 && <p class="contributor-entry-hint"><UserRound size={18} /> Down for Cast &amp; Crew</p>}
      </section>
      {media.poster && <img class="detail-poster" src={media.poster} alt="" />}
      {focus.zone === 'person' && contributors.length > 0 && <ContributorBrowser
        media={media}
        focus={focus}
        onFocus={onPersonFocus}
        onSelect={onPersonSelect}
      />}
      {trailerOpen && trailerId && (
        trailerSource
          ? <TrailerPlayer videoId={trailerId} source={trailerSource} title={media.title} backdrop={media.backdrop || media.poster} onClose={onTrailerClose} />
          : <section class="series-trailer-overlay" role="dialog" aria-modal="true" aria-label={`${media.title} trailer`}>
              <div class="series-trailer-native-cover is-visible" style={(media.backdrop || media.poster) ? { backgroundImage: `url("${(media.backdrop || media.poster)!.replace(/"/g, '%22')}")` } : undefined}>
                <span>{trailerError ? <X size={32} /> : <Film size={32} />}</span>
              </div>
              <div class="series-trailer-hud is-visible"><header><div><p>{trailerError ? 'Trailer unavailable' : 'Preparing trailer'}</p><h2>{trailerError || media.title}</h2></div></header></div>
              <button class="series-trailer-close" type="button" onClick={onTrailerClose} aria-label="Back to title"><X size={22} /> Back to title</button>
            </section>
      )}
    </main>
  )
}

export function SettingsScreen({
  focus,
  activeNav,
  paired,
  connected,
  deviceId,
  confirmation,
  playbackSettings,
  onNav,
  onNavFocus,
  onFocus,
  onAction,
}: {
  focus: FocusLocation
  activeNav: number
  paired: boolean
  connected: boolean
  deviceId?: string
  confirmation: SettingsConfirmation
  playbackSettings: PlaybackExperienceSettings
  onNav(index: number): void
  onNavFocus(index: number): void
  onFocus(index: number): void
  onAction(index: number): void
}) {
  const confirmTitle = confirmation === 'unpair' ? 'Unpair this TV?' : 'Reset the companion?'
  const settingsOptions = [
    { title: 'Cinematic home carousel', detail: 'Keep featured artwork above the rows instead of expanding each focused card.', icon: Tv, enabled: playbackSettings.homeCarouselLayout },
    { title: 'Video previews', detail: 'Play trailers automatically after you pause on a title.', icon: Film, enabled: playbackSettings.videoPreviewsEnabled },
    { title: 'Autoplay next episode', detail: 'Show a short countdown, then continue the series.', icon: Play, enabled: playbackSettings.autoplayNextEpisode },
    { title: 'Automatically skip segments', detail: 'Use AniSkip, IntroDB and chapter timing supplied by izumi.', icon: Captions, enabled: playbackSettings.autoSkipSegments },
    { title: 'Still watching check', detail: 'Pause autoplay after three episodes until you confirm.', icon: ShieldCheck, enabled: playbackSettings.stillWatchingEnabled },
    { title: 'Keep the current source', detail: 'Prefer the same provider when the next episode is available.', icon: History, enabled: playbackSettings.preferBingeSource },
    { title: 'Unpair this TV', detail: 'Disconnect this TV from your izumi sync group.', icon: Link2Off },
    { title: 'Reset companion', detail: 'Remove pairing, preferences and this TV identity.', icon: RotateCcw },
  ]
  return (
    <main class="utility-screen settings-screen">
      <NavRail activeIndex={activeNav} focus={focus} onFocus={onNavFocus} onSelect={onNav} />
      <header class="utility-heading">
        <p><ShieldCheck size={20} /> TV companion</p>
        <h1>Settings</h1>
      </header>
      <section class="settings-panel">
        <div class="device-summary">
          <div class={`device-status-dot${connected ? ' online' : ''}`} />
          <div><p>{paired ? 'Paired with izumi' : 'Not paired'}</p><span>{connected ? 'Receiver online' : 'Waiting for a nearby device'} · TV {deviceId?.slice(-6).toUpperCase() || 'PREVIEW'}</span></div>
        </div>
        <div class="settings-options">
          {settingsOptions.map(({ title, detail, icon: Icon, enabled }, index) => (
            <button
              type="button"
              class={`${focus.zone === 'setting' && focus.index === index && !confirmation ? 'is-focused' : ''}${enabled !== undefined ? ' is-toggle' : ''}`}
              aria-pressed={enabled}
              data-focus-id={!confirmation ? `setting-${index}` : undefined}
              tabIndex={!confirmation && focus.zone === 'setting' && focus.index === index ? 0 : -1}
              onFocus={() => onFocus(index)}
              onMouseEnter={() => onFocus(index)}
              onClick={() => onAction(index)}
              key={title}
            >
              <Icon size={28} /><span><strong>{title}</strong><small>{detail}</small></span>
              {enabled !== undefined ? <span class={`settings-toggle${enabled ? ' is-on' : ''}`}><i />{enabled ? 'On' : 'Off'}</span> : <ChevronRight size={24} />}
            </button>
          ))}
        </div>
      </section>
      {confirmation && (
        <div class="settings-confirm-backdrop">
          <section class="settings-confirm" role="dialog" aria-modal="true" aria-label={confirmTitle}>
            <h2>{confirmTitle}</h2>
            <p>{confirmation === 'unpair'
              ? 'You will need to scan a new pairing code before this TV can access your izumi home again.'
              : 'This removes all companion data stored on the TV and creates a new TV identity.'}</p>
            <div>
              {['Cancel', confirmation === 'unpair' ? 'Unpair' : 'Reset'].map((label, index) => (
                <button
                  type="button"
                  class={focus.zone === 'setting' && focus.index === index ? 'is-focused' : ''}
                  data-focus-id={`setting-${index}`}
                  onFocus={() => onFocus(index)}
                  onClick={() => onAction(index)}
                  key={label}
                >{label}</button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
