import { DiscoveryScreen } from './components/DiscoveryScreen'
import { DISCOVERY_REMOTE, DISCOVERY_CHANGED } from './lib/discovery'
import { ProfileScreen, PROFILE_REMOTE } from './components/ProfileScreen'
import { PROFILES_CHANGED, tvHousehold, tvProfileReady, tvProfileId } from './lib/profiles'
import QRCode from 'qrcode'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  CatalogScreen,
  DetailScreen,
  SEARCH_KEY_LAST_ROW,
  SEARCH_KEYS,
  SEARCH_VOICE_KEY_INDEX,
  SearchScreen,
  SeriesScreen,
  SettingsScreen,
  adjacentSearchKey,
  contributorsFor,
  detailActionsFor,
  nearestSearchKey,
  relatedTitlesFor,
  seriesOverviewActionsFor,
  youtubeTrailerId,
  type SeriesOverviewAction,
  type SettingsConfirmation,
  TRAILER_CONTROL_EVENT,
  type TrailerControlAction,
} from './components/CatalogScreens'
import { HomeScreen, trailerNeedsEnglishCaptions } from './components/HomeScreen'
import { NavigationSkeleton } from './components/NavigationSkeleton'
import { PreviewToolbar } from './components/PreviewToolbar'
import { ErrorScreen, ExitConfirmation, IndependentSetupScreen, LoadingScreen, PlayerScreen, PostPlayScreen, ReadyScreen, StandaloneLinkScreen, type IndependentSetupPhase } from './components/StateScreens'
import { navDestinationAt, navIndexFor, navItemCount } from './components/NavRail'
import { previewDetailsFor, previewSnapshot, previewSnapshotForCatalog } from './data/preview'
import { AvPlayController } from './lib/avplay'
import { browseCategoryRows } from './lib/browse'
import { catalogCollections, episodeCountsFor, seasonIndexFor, seasonNumberFor } from './lib/catalog'
import { preloadHomeMedia } from './lib/home-image-cache'
import {
  catalogMediaDestination,
  homeDetailPrefetchTargets,
  homeHeroItems,
  homeSnapshotForKind,
  isMergedCatalog,
  mergeHomeMediaDetails,
  mergedCatalogOption,
  orderedHomeRows,
  rememberedHomeRowIndex,
  wrappedHeroIndex,
} from './lib/home-navigation'
import { popNavigationEntry, pushNavigationEntry } from './lib/navigation-history'
import { normalizeTvLinkCode, tvLinkUrl } from './lib/onboarding'
import { registerRemoteKeys, remoteAction, type RemoteAction } from './lib/remote'
import { CompanionReceiver } from './lib/receiver'
import { ExternalSubtitleController } from './lib/subtitles'
import { applyTrackHints, preferredTrack, subtitleTrackLabel } from './lib/track-selection'
import { markFocusApplied, markRemoteInput, markScrollSettled, tvNow } from './lib/tv-performance'
import { TvLinkReceiver, type TvLinkInfo } from './lib/tv-link'
import { installVoiceSearch } from './lib/voice-search'
import { mediaRatingKey, readMediaRatings, writeMediaRating, type MediaRating } from './lib/media-rating'
import {
  activeSkipSegment,
  nextEpisodeFor,
  PLAYER_SEEK_STEP_SECONDS,
  playerSeekTarget,
  postPlayRecommendations,
  readPlaybackExperienceSettings,
  shouldOfferNextEpisode,
  seekHoldMultiplier,
  skipSegmentKey,
  writePlaybackExperienceSettings,
  type PlaybackExperienceSettings,
} from './lib/playback-experience'
import type {
  CastControlRequest,
  CastLoadRequest,
  CompanionCatalogOption,
  CompanionHomeSnapshot,
  CompanionMedia,
  CompanionPerson,
  CompanionSkipSegment,
  FocusLocation,
  LinkedDeviceSourceChoice,
  LinkedDeviceSourceOptions,
  PairingInfo,
  PlaybackState,
  PlaybackSourceChoice,
  PlaybackTrack,
  PlayerMenu,
  ScreenName,
  SubtitleChoice,
  SubtitlePreferences,
  SubtitleStyle,
} from './types'

interface PlayerView {
  title: string
  state: PlaybackState
  position: number
  duration: number
  bufferedPosition: number
  isLive: boolean
}

const fallbackMedia: CompanionMedia = {
  ref: { provider: 'izumi', id: 'empty', type: 'anime' },
  title: 'Your anime, on the big screen',
  description: 'Pair izumi to fill this screen with your own library and progress.',
}

const emptySnapshot: CompanionHomeSnapshot = {
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'unpaired',
  generatedAt: 0,
  catalog: { screen: 'home', label: 'Home' },
  rows: [],
}

const offSubtitle: SubtitleChoice = { id: 'off', label: 'Off', kind: 'off' }
const previewAudioTracks: PlaybackTrack[] = [
  { type: 'AUDIO', index: 0, language: 'ja', label: 'Japanese · Stereo' },
  { type: 'AUDIO', index: 1, language: 'en', label: 'English · 5.1' },
]
const previewSubtitleChoices: SubtitleChoice[] = [
  offSubtitle,
  { id: 'preview-en', label: 'English', kind: 'embedded', index: 0 },
  { id: 'preview-es', label: 'Spanish', kind: 'embedded', index: 1 },
  { id: 'preview-fr', label: 'French', kind: 'embedded', index: 2 },
]

const sourceSubtitlePreferences = (): SubtitlePreferences => ({
  size: 'source',
  background: 'source',
  delayMs: 0,
})

function subtitlePreferencesFor(style?: SubtitleStyle): SubtitlePreferences {
  if (!style?.enabled) return sourceSubtitlePreferences()
  const fontSize = Number(style.fontSize) || 42
  return {
    size: fontSize < 40 ? 'small' : fontSize < 55 ? 'medium' : 'large',
    background: Number(style.shadow) > 0 ? 'shadow' : 'none',
    delayMs: 0,
    castStyle: style,
  }
}

const dpadScrollAnimations = new WeakMap<HTMLElement, number>()

/** Coalesce repeated D-pad presses into the newest target, keeping motion visible without building
 * an animation queue on older Tizen browser engines. */
function animateScroll(
  element: HTMLElement,
  property: 'scrollLeft' | 'scrollTop',
  target: number,
  duration = property === 'scrollLeft' ? 165 : 210,
): void {
  const previousFrame = dpadScrollAnimations.get(element)
  if (previousFrame !== undefined) window.cancelAnimationFrame(previousFrame)
  const maximum = property === 'scrollLeft'
    ? Math.max(0, element.scrollWidth - element.clientWidth)
    : Math.max(0, element.scrollHeight - element.clientHeight)
  const destination = Math.min(maximum, Math.max(0, Math.round(target)))
  const start = element[property]
  const distance = destination - start
  if (Math.abs(distance) < 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    element[property] = destination
    dpadScrollAnimations.delete(element)
    return
  }
  const startedAt = tvNow()
  const step = (_now: number) => {
    const elapsed = Math.min(1, (tvNow() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - elapsed, 3)
    element[property] = Math.round(start + distance * eased)
    if (elapsed < 1) dpadScrollAnimations.set(element, window.requestAnimationFrame(step))
    else {
      dpadScrollAnimations.delete(element)
      markScrollSettled(property, startedAt, distance)
    }
  }
  dpadScrollAnimations.set(element, window.requestAnimationFrame(step))
}

interface HomeDetailTask {
  media: CompanionMedia
  generation: number
  preview: boolean
}

interface NavigationScrollPosition {
  selector: string
  left: number
  top: number
}

interface NavigationEntry {
  screen: ScreenName
  focus: FocusLocation
  selected: CompanionMedia
  activeNav: number
  heroIndex: number
  homeRowIndexes: Record<string, number>
  seriesSeason: number
  searchQuery: string
  searchPerson?: CompanionPerson
  searchGenre?: string
  searchResults?: CompanionMedia[]
  searchPending: boolean
  searchError: string
  scroll: NavigationScrollPosition[]
}

const NAVIGATION_SCROLL_SELECTORS = [
  '.home-screen',
  '.home-motion-track',
  '.browse-catalog',
  '.search-results',
  '.series-library-scroll',
  '.season-options > div',
  '.series-relation-list',
  '.contributor-strip',
]

const RESTORABLE_SCREENS: ScreenName[] = [
  'home',
  'trending',
  'series-home',
  'movies',
  'search',
  'series',
  'details',
  'my-list',
  'watch-history',
]

const HOME_DETAIL_CONCURRENCY = 6
const HOME_PRESENTATION_CACHE_LIMIT = 32
const SEEK_HOLD_START_DELAY_MS = 360
const SEEK_HOLD_PULSE_MS = 360
const SEEK_HOLD_RELEASE_GRACE_MS = 280

function homeMediaKey(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

function sameMedia(left: CompanionMedia, right: CompanionMedia): boolean {
  return left.ref.provider === right.ref.provider && left.ref.type === right.ref.type && left.ref.id === right.ref.id
}

function focusId(focus: FocusLocation): string {
  if (focus.zone === 'row') return `row-${focus.row}-${focus.index}`
  if (focus.zone === 'grid') return `grid-${focus.index}`
  if (focus.zone === 'keyboard') return `keyboard-${focus.index}`
  if (focus.zone === 'setting') return `setting-${focus.index}`
  return `${focus.zone}-${focus.index}`
}

function initialScreen(): ScreenName {
  const requested = new URLSearchParams(location.search).get('screen')
  if (requested && ['home', 'search', 'trending', 'series-home', 'series', 'movies', 'my-list', 'discover', 'watch-history', 'settings', 'independent-setup', 'standalone-link', 'details', 'ready', 'loading', 'player', 'postplay', 'error'].includes(requested)) return requested as ScreenName
  return import.meta.env.DEV ? 'home' : 'ready'
}

type CinematicDestination = 'home' | 'trending' | 'series-home' | 'movies'

function cinematicSnapshotFor(snapshot: CompanionHomeSnapshot, destination: CinematicDestination): CompanionHomeSnapshot {
  const ordered = { ...snapshot, rows: orderedHomeRows(snapshot.rows) }
  if (destination === 'trending') return { ...snapshot, rows: browseCategoryRows(snapshot) }
  if (destination === 'series-home') return homeSnapshotForKind(ordered, 'show')
  if (destination === 'movies') return homeSnapshotForKind(ordered, 'movie')
  return ordered
}

export function App({ onStartupSettled }: { onStartupSettled?(): void }) {
  const previewParameters = useMemo(() => new URLSearchParams(location.search), [])
  const showPreviewTools = import.meta.env.DEV || previewParameters.has('preview')
  const showPreviewToolbar = showPreviewTools && !previewParameters.has('capture')
  const initialDestination = useMemo(initialScreen, [])
  const requestedPreviewCatalog = previewParameters.get('catalog')
    ?? (initialDestination === 'trending' ? 'merged' : previewSnapshot.catalog.screen)
  const initialPreviewSnapshot = useMemo(() => previewSnapshotForCatalog(requestedPreviewCatalog), [requestedPreviewCatalog])
  const initialDisplaySnapshot = useMemo(() => ['home', 'trending', 'series-home', 'movies'].includes(initialDestination)
    ? cinematicSnapshotFor(initialPreviewSnapshot, initialDestination as CinematicDestination)
    : initialPreviewSnapshot, [initialDestination, initialPreviewSnapshot])
  const [screen, setScreen] = useState<ScreenName>(initialDestination)
  const [snapshot, setSnapshot] = useState<CompanionHomeSnapshot>(initialPreviewSnapshot)
  const [selected, setSelected] = useState<CompanionMedia>(() => {
    const media = initialDestination === 'watch-history'
      ? initialPreviewSnapshot.history?.[0] ?? fallbackMedia
      : initialDisplaySnapshot.hero ?? initialDisplaySnapshot.rows[0]?.items[0] ?? fallbackMedia
    return showPreviewTools && (initialDestination === 'series' || initialDestination === 'details')
      ? previewDetailsFor(media)
      : media
  })
  const [heroIndex, setHeroIndex] = useState(0)
  const [focus, setFocus] = useState<FocusLocation>(initialDestination === 'details'
    ? { zone: 'detail', index: 0 }
    : initialDestination === 'series'
      ? { zone: 'series-action', index: 0 }
      : initialDestination === 'independent-setup'
        ? { zone: 'setting', index: 1 }
      : initialDestination === 'ready' || initialDestination === 'standalone-link'
        ? { zone: 'setting', index: 0 }
      : initialDestination === 'settings'
          ? { zone: 'setting', index: 0 }
          : initialDestination === 'my-list' || initialDestination === 'watch-history'
            ? { zone: 'grid', index: 0 }
          : { zone: 'hero', index: 0 })
  const [profilesOpen, setProfilesOpen] = useState(!tvProfileReady())
  const profilesOpenRef = useRef(profilesOpen)
  profilesOpenRef.current = profilesOpen
  const [activeNav, setActiveNav] = useState(navIndexFor(initialDestination))
  const [notice, setNotice] = useState('')
  const [safeArea, setSafeArea] = useState(false)
  const [connected, setConnected] = useState(false)
  const [paired, setPaired] = useState(Boolean(localStorage.getItem('izumi.companion.credential')))
  const [pairing, setPairing] = useState<PairingInfo>()
  const [qrCode, setQrCode] = useState<string>()
  const [standaloneQrCode, setStandaloneQrCode] = useState<string>()
  const [tvLinkInfo, setTvLinkInfo] = useState<TvLinkInfo>({ code: '', expiresAt: 0, phase: 'preparing' })
  const pairingChallenge = normalizeTvLinkCode(pairing?.challenge ?? (showPreviewTools ? 'TV42IZ' : ''))
  const pairingDisplayCode = pairingChallenge
    ? `${pairingChallenge.slice(0, 3)} ${pairingChallenge.slice(3, 6)}`
    : ''
  const tvLinkDisplayCode = tvLinkInfo.code
    ? `${tvLinkInfo.code.slice(0, 4)} ${tvLinkInfo.code.slice(4, 8)}`
    : ''
  const [loadingProgress, setLoadingProgress] = useState(previewParameters.get('scenario') === 'buffering' ? 46 : 34)
  const [errorMessage, setErrorMessage] = useState('The TV player could not open this source.')
  const [player, setPlayer] = useState<PlayerView>({
    title: previewSnapshot.hero?.title ?? 'Now Playing',
    state: previewParameters.get('scenario') === 'buffering' ? 'buffering' : 'playing',
    position: previewParameters.get('scenario') === 'next' ? 1_225 : 523,
    duration: 1_422,
    bufferedPosition: previewParameters.get('scenario') === 'next' ? 1_255 : 611,
    isLive: false,
  })
  const [playerControlFocus, setPlayerControlFocus] = useState(0)
  const [playerToolsActive, setPlayerToolsActive] = useState(false)
  const [playerControlsVisible, setPlayerControlsVisible] = useState(true)
  const [seekFeedback, setSeekFeedback] = useState<{ direction: 'backward' | 'forward'; multiplier: number; seconds: number }>()
  const previewScenario = previewParameters.get('scenario')
  const [playbackMedia, setPlaybackMedia] = useState<CompanionMedia>(initialPreviewSnapshot.hero ?? fallbackMedia)
  const [skipSegments, setSkipSegments] = useState<CompanionSkipSegment[]>(previewScenario === 'next' ? [
    { type: 'op', startTime: 45, endTime: 135, label: 'Skip intro' },
    { type: 'ed', startTime: 1_200, endTime: 1_390, label: 'Skip ending' },
  ] : [])
  const [visibleSkipSegment, setVisibleSkipSegment] = useState<CompanionSkipSegment>()
  const [nextEpisodeVisible, setNextEpisodeVisible] = useState(previewScenario === 'next')
  const [nextEpisodeDismissed, setNextEpisodeDismissed] = useState(false)
  const [nextCountdown, setNextCountdown] = useState<number>()
  const [nextSourceReady, setNextSourceReady] = useState(false)
  const [playerPromptFocus, setPlayerPromptFocus] = useState<'transport' | 'timeline' | 'skip' | 'next'>('transport')
  const [postPlayMedia, setPostPlayMedia] = useState<CompanionMedia>(initialPreviewSnapshot.hero ?? fallbackMedia)
  const [postPlayFocus, setPostPlayFocus] = useState(previewParameters.get('scenario') === 'recommendations' ? 3 : 0)
  const [postPlayStage, setPostPlayStage] = useState<'rating' | 'recommendations'>(previewParameters.get('scenario') === 'recommendations' ? 'recommendations' : 'rating')
  const [postPlayRatingTransitioning, setPostPlayRatingTransitioning] = useState(false)
  const [mediaRatings, setMediaRatings] = useState(() => readMediaRatings())
  const [stillWatching, setStillWatching] = useState(false)
  const [stillWatchingFocus, setStillWatchingFocus] = useState(0)
  const [playbackSettings, setPlaybackSettings] = useState<PlaybackExperienceSettings>(() => {
    const settings = readPlaybackExperienceSettings()
    const previewLayout = previewParameters.get('layout')
    return showPreviewTools && (previewLayout === 'carousel' || previewLayout === 'spotlight')
      ? { ...settings, homeCarouselLayout: previewLayout === 'carousel' }
      : settings
  })
  const upcomingEpisode = useMemo(() => nextEpisodeFor(playbackMedia), [playbackMedia])
  const [playerMenu, setPlayerMenu] = useState<PlayerMenu | null>(null)
  const [playerMenuFocus, setPlayerMenuFocus] = useState(0)
  const [sourceChoices, setSourceChoices] = useState<PlaybackSourceChoice[]>([])
  const sourceChoicesRef = useRef<PlaybackSourceChoice[]>([])
  const failedCloudSourcesRef = useRef<Set<string>>(new Set())
  const [deviceSourceOptions, setDeviceSourceOptions] = useState<LinkedDeviceSourceOptions>()
  const [activeSourceId, setActiveSourceId] = useState<string>()
  const [deviceSourceChangeAvailable, setDeviceSourceChangeAvailable] = useState(false)
  const [audioTracks, setAudioTracks] = useState<PlaybackTrack[]>(showPreviewTools ? previewAudioTracks : [])
  const [activeAudio, setActiveAudio] = useState<number | undefined>(showPreviewTools ? 0 : undefined)
  const [subtitleChoices, setSubtitleChoices] = useState<SubtitleChoice[]>(showPreviewTools ? previewSubtitleChoices : [offSubtitle])
  const [activeSubtitle, setActiveSubtitle] = useState(showPreviewTools ? 'preview-en' : 'off')
  const [subtitleText, setSubtitleText] = useState(showPreviewTools ? 'Even the smallest journey can change the world.' : '')
  const [subtitlePreferences, setSubtitlePreferences] = useState<SubtitlePreferences>(sourceSubtitlePreferences)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchPerson, setSearchPerson] = useState<CompanionPerson>()
  const [searchGenre, setSearchGenre] = useState<string>()
  const [remoteSearchResults, setRemoteSearchResults] = useState<CompanionMedia[]>()
  const [searchPending, setSearchPending] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [seriesSeason, setSeriesSeason] = useState(0)
  const [settingsConfirmation, setSettingsConfirmation] = useState<SettingsConfirmation>(null)
  const [independentPlaybackReady, setIndependentPlaybackReady] = useState(false)
  const [independentSetupPhase, setIndependentSetupPhase] = useState<IndependentSetupPhase>('intro')
  const [independentSetupError, setIndependentSetupError] = useState('')
  const [catalogMenuOpen, setCatalogMenuOpen] = useState(false)
  const [catalogMenuFocus, setCatalogMenuFocus] = useState(0)
  const [navigationPhase, setNavigationPhase] = useState<'idle' | 'loading' | 'leaving'>('idle')
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [trailerSource, setTrailerSource] = useState<{ requestId?: string; url: string }>()
  const [trailerError, setTrailerError] = useState('')
  const [homeTrailerPreview, setHomeTrailerPreview] = useState<{ mediaKey: string; requestId?: string; url: string }>()
  const [exitConfirmation, setExitConfirmation] = useState(false)
  const [exitFocus, setExitFocus] = useState(0)
  const [focusRestoreEpoch, setFocusRestoreEpoch] = useState(0)

  const receiverRef = useRef<CompanionReceiver>()
  const tvLinkReceiverRef = useRef<TvLinkReceiver>()
  const avplayRef = useRef(new AvPlayController())
  const activeLoadRef = useRef<CastLoadRequest>()
  const playerRef = useRef(player)
  const noticeTimerRef = useRef<number>()
  const simulationTimerRef = useRef<number>()
  const playRequestGenerationRef = useRef(0)
  const navigationTimerRef = useRef<number>()
  const navigationExitTimerRef = useRef<number>()
  const navigationStartedAtRef = useRef(0)
  const subtitleTimerRef = useRef<number>()
  const searchTimerRef = useRef<number>()
  const searchResponseTimerRef = useRef<number>()
  const heroIndexRef = useRef(0)
  const homeRowIndexesRef = useRef<Record<string, number>>({})
  const startupSettledRef = useRef(false)
  const startupSettleFrameRef = useRef<number>()
  const startupFallbackTimerRef = useRef<number>()
  const searchQueryRef = useRef(searchQuery)
  const searchPersonRef = useRef<CompanionPerson>()
  const searchGenreRef = useRef<string>()
  const searchKeyboardColumnRef = useRef(0)
  const playerControlsTimerRef = useRef<number>()
  const seekFeedbackTimerRef = useRef<number>()
  const seekHoldDelayRef = useRef<number>()
  const seekHoldIntervalRef = useRef<number>()
  const seekHoldReleaseRef = useRef<number>()
  const seekHoldActionRef = useRef<'rewind' | 'fastForward'>()
  const seekHoldStartedRef = useRef(0)
  const pendingSeekRef = useRef<number>()
  const seekInFlightRef = useRef(false)
  const catalogRequestRef = useRef<{
    screen: string
    label: string
    timer: number
    previousIndex: number
    destination: 'home' | 'trending'
  }>()
  const externalSubtitlesRef = useRef(new ExternalSubtitleController())
  const activeSubtitleRef = useRef(activeSubtitle)
  const activeSubtitleLabelRef = useRef('')
  const subtitleStateRef = useRef<'off' | 'loading' | 'ready' | 'error'>('off')
  const subtitleErrorRef = useRef('')
  const subtitleLoadGenerationRef = useRef(0)
  const appliedAudioPreferenceRef = useRef('')
  const audioSelectionGenerationRef = useRef(0)
  const appliedSubtitlePreferenceRef = useRef('')
  const subtitlePreferencesRef = useRef(subtitlePreferences)
  const trailerSourceRef = useRef<{ requestId?: string; url: string }>()
  const trailerGenerationRef = useRef(0)
  const homeTrailerPreviewRef = useRef<{ mediaKey: string; requestId?: string; url: string }>()
  const homeTrailerGenerationRef = useRef(0)
  const homeDetailRequestsRef = useRef(new Set<string>())
  const homeDetailRequestOrderRef = useRef<string[]>([])
  const homeDetailQueueRef = useRef<HomeDetailTask[]>([])
  const homeDetailActiveRef = useRef(0)
  const homeDetailGenerationRef = useRef(0)
  const homePresentationCacheRef = useRef(new Map<string, CompanionMedia>())
  const navigationHistoryRef = useRef<NavigationEntry[]>([])
  const pendingNavigationScrollRef = useRef<NavigationScrollPosition[]>()
  const lastHomeContentFocusRef = useRef<FocusLocation>({ zone: 'hero', index: 0 })
  const focusRef = useRef<FocusLocation>(focus)
  const screenRef = useRef<ScreenName>(screen)
  const appliedFocusRef = useRef<{ focus: FocusLocation; screen: ScreenName }>()
  const remoteHandlerRef = useRef<(action: RemoteAction) => void>()
  const seekHoldKeyDownRef = useRef<(action: RemoteAction, repeated: boolean) => boolean>()
  const seekHoldKeyUpRef = useRef<(action: RemoteAction) => void>()
  const completedPlaybackRef = useRef<() => void>()
  const playbackTimeRef = useRef<(position: number, duration: number) => void>()
  const playNextEpisodeRef = useRef<() => void>()
  const handledSkipSegmentsRef = useRef<string[]>([])
  const prefetchedNextRef = useRef('')
  const autoplayCountRef = useRef(0)
  const currentSourceLabelRef = useRef('')
  const postPlayPresentedRef = useRef(false)
  const playbackEndedRef = useRef(false)
  const postPlayTransitionTimerRef = useRef<number>()

  screenRef.current = screen
  searchPersonRef.current = searchPerson
  searchGenreRef.current = searchGenre

  const setFocusLocation = (next: FocusLocation) => {
    focusRef.current = next
    setFocus((current) => focusId(current) === focusId(next) ? current : next)
  }

  const settleStartupAfterPaint = () => {
    if (!onStartupSettled || startupSettledRef.current) return
    startupSettledRef.current = true
    if (startupFallbackTimerRef.current) window.clearTimeout(startupFallbackTimerRef.current)
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      if (startupFallbackTimerRef.current) window.clearTimeout(startupFallbackTimerRef.current)
      onStartupSettled()
    }
    startupFallbackTimerRef.current = window.setTimeout(settle, 250)
    startupSettleFrameRef.current = window.requestAnimationFrame(() => {
      startupSettleFrameRef.current = window.requestAnimationFrame(settle)
    })
  }

  const revealPlayerControls = (hold = false) => {
    setPlayerControlsVisible(true)
    if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
    if (!hold && playerRef.current.state === 'playing' && !playerToolsActive && !playerMenu && playerPromptFocus !== 'timeline') {
      playerControlsTimerRef.current = window.setTimeout(() => setPlayerControlsVisible(false), 3_600)
    }
  }

  const requestExit = () => {
    setExitFocus(0)
    setExitConfirmation(true)
  }

  const exitApplication = () => {
    setExitConfirmation(false)
    const application = window.tizen?.application?.getCurrentApplication()
    if (application) application.exit()
    else showNotice('Exit confirmation works on the TV runtime')
  }

  const updatePlayer = (next: Partial<PlayerView>) => {
    const value = { ...playerRef.current, ...next }
    playerRef.current = value
    setPlayer(value)
  }

  const audioSnapshot = () => {
    const audio = window.tizen?.tvaudiocontrol
    if (!audio) return {}
    try { return { volume: audio.getVolume() / 100, muted: audio.isMute() } } catch { return {} }
  }

  const publishStatus = (forced = false, error?: string) => {
    const request = activeLoadRef.current
    if (!request) return
    const view = playerRef.current
    const subtitleId = activeSubtitleRef.current
    const externalTrackId = subtitleId.startsWith('external-') ? Number(subtitleId.slice('external-'.length)) : undefined
    receiverRef.current?.publishStatus({
      sessionId: request.sessionId,
      state: view.state,
      positionSeconds: view.position,
      durationSeconds: view.duration || undefined,
      ...audioSnapshot(),
      subtitleState: subtitleStateRef.current,
      subtitleTitle: subtitleId === 'off' ? undefined : activeSubtitleLabelRef.current,
      activeTrackIds: Number.isFinite(externalTrackId) ? [externalTrackId!] : [],
      error,
      subtitleError: subtitleErrorRef.current || undefined,
      forced,
    })
  }

  const selectAudioTrack = (track: PlaybackTrack) => {
    const generation = ++audioSelectionGenerationRef.current
    setPlayerMenu(null)
    if (!avplayRef.current.available) {
      setActiveAudio(track.index)
      return
    }
    void avplayRef.current.selectTrack('AUDIO', track.index).then((selected) => {
      if (generation !== audioSelectionGenerationRef.current) return
      if (selected) {
        setActiveAudio(track.index)
        showNotice(`${track.label} selected`)
      } else {
        const current = avplayRef.current.currentTrackIndex('AUDIO')
        if (current !== undefined) setActiveAudio(current)
        showNotice('The player could not switch to that audio track.')
      }
    }).catch((error) => {
      if (generation !== audioSelectionGenerationRef.current) return
      setErrorMessage(error instanceof Error ? error.message : 'This audio track is unavailable.')
      showNotice('This audio track is unavailable.')
    })
  }

  const selectSubtitleChoice = (choice: SubtitleChoice) => {
    activeSubtitleRef.current = choice.id
    const loadGeneration = ++subtitleLoadGenerationRef.current
    setActiveSubtitle(choice.id)
    activeSubtitleLabelRef.current = choice.kind === 'off' ? '' : choice.label
    subtitleStateRef.current = choice.kind === 'off' ? 'off' : choice.kind === 'external' ? 'loading' : 'ready'
    subtitleErrorRef.current = ''
    setSubtitleText('')
    externalSubtitlesRef.current.clear()
    if (choice.kind === 'off') avplayRef.current.hideSubtitles(true)
    else if (choice.kind === 'embedded' && choice.index != null) {
      // Silent mode suppresses Samsung's native overlay while keeping subtitle events enabled.
      // The app renders those events so embedded and external tracks share one reliable layer.
      avplayRef.current.hideSubtitles(true)
      if (avplayRef.current.available) void avplayRef.current.selectTrack('TEXT', choice.index).then((selected) => {
        if (!selected) showNotice('The player could not switch to that subtitle track.')
      }).catch((error) => setErrorMessage(error instanceof Error ? error.message : 'This subtitle track is unavailable.'))
      if (showPreviewTools && !activeLoadRef.current) setSubtitleText('Even the smallest journey can change the world.')
    } else if (choice.kind === 'external' && choice.url) {
      avplayRef.current.hideSubtitles(true)
      void externalSubtitlesRef.current.load(choice.url, choice.contentType).then(() => {
        if (subtitleLoadGenerationRef.current !== loadGeneration) return
        subtitleStateRef.current = 'ready'
        publishStatus(true)
      }).catch((error) => {
        if (subtitleLoadGenerationRef.current !== loadGeneration) return
        const message = error instanceof Error ? error.message : 'That subtitle file could not be loaded on this TV.'
        subtitleStateRef.current = 'error'
        subtitleErrorRef.current = message
        setNotice(message)
        publishStatus(true)
      })
    }
    setPlayerMenu(null)
  }

  const changeSubtitleAppearance = (setting: 'size' | 'background' | 'delay') => {
    const current = subtitlePreferencesRef.current
    const sizes: SubtitlePreferences['size'][] = ['source', 'small', 'medium', 'large']
    const backgrounds: SubtitlePreferences['background'][] = ['source', 'none', 'shadow', 'box']
    const delays = [-500, 0, 500, 1_000]
    const next: SubtitlePreferences = setting === 'size'
      ? { ...current, castStyle: undefined, size: sizes[(sizes.indexOf(current.size) + 1) % sizes.length] }
      : setting === 'background'
        ? { ...current, castStyle: undefined, background: backgrounds[(backgrounds.indexOf(current.background) + 1) % backgrounds.length] }
        : { ...current, delayMs: delays[(delays.indexOf(current.delayMs) + 1) % delays.length] }
    subtitlePreferencesRef.current = next
    setSubtitlePreferences(next)
    if (activeSubtitleRef.current.startsWith('embedded-')) avplayRef.current.hideSubtitles(true)
    avplayRef.current.setSubtitleDelay(next.delayMs)
  }

  const hidePlayerControls = () => {
    if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
    playerControlsTimerRef.current = undefined
    setPlayerControlsVisible(false)
  }

  const restoreHomeNavigation = () => {
    const previous = lastHomeContentFocusRef.current
    const next = previous.zone === 'row'
      && Boolean(homeRows[previous.row]?.items[previous.index])
      ? previous
      : previous.zone === 'hero' && previous.index >= 0 && previous.index < homeHeroRail.length
        ? previous
        : { zone: 'hero', index: 0 } as FocusLocation
    setCatalogMenuOpen(false)
    setActiveNav(0)
    appliedFocusRef.current = undefined
    lastHomeContentFocusRef.current = next
    if (next.zone === 'row') {
      const media = homeRows[next.row]?.items[next.index]
      if (media) setSelected(media)
    } else if (next.zone === 'hero') {
      const media = homeHeroRail[next.index]
      heroIndexRef.current = next.index
      setHeroIndex(next.index)
      if (media) setSelected(media)
    }
    setScreen('home')
    setFocusLocation(next)
    setFocusRestoreEpoch((value) => value + 1)
  }

  const captureNavigationScroll = (): NavigationScrollPosition[] => NAVIGATION_SCROLL_SELECTORS.flatMap((selector) => {
    const element = document.querySelector<HTMLElement>(selector)
    return element ? [{ selector, left: element.scrollLeft, top: element.scrollTop }] : []
  })

  const pushCurrentNavigation = () => {
    const currentScreen = screenRef.current
    if (!RESTORABLE_SCREENS.includes(currentScreen)) return
    navigationHistoryRef.current = pushNavigationEntry(navigationHistoryRef.current, {
      screen: currentScreen,
      focus: focusRef.current,
      selected,
      activeNav,
      heroIndex: heroIndexRef.current,
      homeRowIndexes: { ...homeRowIndexesRef.current },
      seriesSeason,
      searchQuery,
      searchPerson,
      searchGenre,
      searchResults: remoteSearchResults,
      searchPending,
      searchError,
      scroll: captureNavigationScroll(),
    })
  }

  const clearNavigationHistory = () => {
    navigationHistoryRef.current = []
    pendingNavigationScrollRef.current = undefined
  }

  const restorePreviousNavigation = (): boolean => {
    const popped = popNavigationEntry(navigationHistoryRef.current)
    if (!popped.entry) return false
    const previous = popped.entry
    navigationHistoryRef.current = popped.history
    pendingNavigationScrollRef.current = previous.scroll
    setCatalogMenuOpen(false)
    setSettingsConfirmation(null)
    setSelected(previous.selected)
    setActiveNav(previous.activeNav)
    heroIndexRef.current = previous.heroIndex
    setHeroIndex(previous.heroIndex)
    homeRowIndexesRef.current = { ...previous.homeRowIndexes }
    setSeriesSeason(previous.seriesSeason)
    searchQueryRef.current = previous.searchQuery
    searchPersonRef.current = previous.searchPerson
    searchGenreRef.current = previous.searchGenre
    setSearchQuery(previous.searchQuery)
    setSearchPerson(previous.searchPerson)
    setSearchGenre(previous.searchGenre)
    setRemoteSearchResults(previous.searchResults)
    setSearchPending(previous.searchPending)
    setSearchError(previous.searchError)
    if (['home', 'trending', 'series-home', 'movies'].includes(previous.screen)) {
      lastHomeContentFocusRef.current = previous.focus
    }
    appliedFocusRef.current = undefined
    setScreen(previous.screen)
    setFocusLocation(previous.focus)
    setFocusRestoreEpoch((value) => value + 1)
    return true
  }

  const stopPlayback = (destination: ScreenName = 'home') => {
    // Publish the terminal state before clearing the authenticated sender session. Android uses
    // this to stop its session-only HTTP-relay foreground service at EOF and on explicit stop.
    updatePlayer({ state: 'idle' })
    publishStatus(true)
    avplayRef.current.close()
    activeLoadRef.current = undefined
    receiverRef.current?.clearPlayback()
    externalSubtitlesRef.current.clear()
    setSubtitleText('')
    subtitleLoadGenerationRef.current += 1
    activeSubtitleRef.current = 'off'
    activeSubtitleLabelRef.current = ''
    subtitleStateRef.current = 'off'
    subtitleErrorRef.current = ''
    setPlayerMenu(null)
    subtitleLoadGenerationRef.current += 1
    activeSubtitleRef.current = 'off'
    activeSubtitleLabelRef.current = ''
    subtitleStateRef.current = 'off'
    subtitleErrorRef.current = ''
    setSourceChoices([])
    setDeviceSourceOptions(undefined)
    setActiveSourceId(undefined)
    updatePlayer({ position: 0 })
    if (destination === 'home') {
      if (!restorePreviousNavigation()) restoreHomeNavigation()
    } else setScreen(destination)
  }

  const startAvPlay = async (request: CastLoadRequest) => {
    playRequestGenerationRef.current += 1
    if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
    const requestedPreferences = subtitlePreferencesFor(request.subtitleStyle)
    appliedAudioPreferenceRef.current = ''
    appliedSubtitlePreferenceRef.current = ''
    subtitlePreferencesRef.current = requestedPreferences
    setSubtitlePreferences(requestedPreferences)
    const externalChoices: SubtitleChoice[] = request.subtitles.map((track, index) => ({
      id: `external-${track.id ?? index + 1}`,
      label: subtitleTrackLabel(track.title, track.lang, index),
      kind: 'external',
      url: track.url,
      contentType: track.contentType,
    }))
    setSubtitleChoices([offSubtitle, ...externalChoices])
    const requestedSubtitle = externalChoices.find((choice) => request.activeTrackIds.includes(Number(choice.id.replace('external-', ''))))
    selectSubtitleChoice(requestedSubtitle ?? offSubtitle)
    activeLoadRef.current = request
    receiverRef.current?.beginPlayback(request)
    const requestedMedia = request.media ?? selected
    setPlaybackMedia(requestedMedia)
    if (request.media) setSelected(request.media)
    setSkipSegments(request.skipSegments ?? [])
    handledSkipSegmentsRef.current = []
    prefetchedNextRef.current = ''
    setVisibleSkipSegment(undefined)
    setNextEpisodeVisible(false)
    setNextEpisodeDismissed(false)
    setNextCountdown(undefined)
    setNextSourceReady(false)
    setStillWatching(false)
    setPlayerPromptFocus('transport')
    setLoadingProgress(0)
    updatePlayer({ title: request.title, state: 'buffering', position: request.positionSeconds, duration: 0, bufferedPosition: request.positionSeconds, isLive: false })
    setScreen('loading')
    publishStatus(true)
    const tryNextCloudSource = (): boolean => {
      if (!request.sessionId.startsWith('cloud-')) return false
      if (failedCloudSourcesRef.current.has(request.sessionId)) return true
      failedCloudSourcesRef.current.add(request.sessionId)
      const next = sourceChoicesRef.current.find((choice) => !failedCloudSourcesRef.current.has(choice.request.sessionId))
      if (!next) return false
      avplayRef.current.close()
      setActiveSourceId(next.id)
      currentSourceLabelRef.current = next.label
      showNotice(`Trying ${next.label} after the previous source failed`)
      window.setTimeout(() => { void startAvPlay(next.request) }, 0)
      return true
    }
    try {
      await avplayRef.current.load(request, {
        onBuffering: (percent) => {
          const reported = typeof percent === 'number' && Number.isFinite(percent)
            ? Math.max(0, Math.min(100, percent))
            : 0
          setLoadingProgress(reported)
          const current = playerRef.current
          const amount = reported / 100
          const bufferedPosition = current.position + amount * (current.position > 0 ? 3 : 5)
          updatePlayer({ state: 'buffering', bufferedPosition: Math.min(current.duration || bufferedPosition, bufferedPosition) })
          publishStatus()
        },
        onState: (state) => {
          updatePlayer({ state })
          if ((state === 'playing' || state === 'paused') && screenRef.current !== 'postplay') setScreen('player')
          publishStatus(true)
        },
        onTime: (position, duration) => {
          // AVPlay exposes progress toward its configured buffer target, but not an absolute
          // buffered range. Keep the rail aligned with the conservative five-second play buffer.
          updatePlayer({ position: pendingSeekRef.current ?? position, duration, bufferedPosition: Math.min(duration, Math.max(playerRef.current.bufferedPosition, position + 5)) })
          playbackTimeRef.current?.(position, duration)
          if (activeSubtitleRef.current.startsWith('external-')) {
            setSubtitleText(externalSubtitlesRef.current.textAt(position, subtitlePreferencesRef.current.delayMs))
          }
        },
        onTracks: (tracks) => {
          const namedTracks = applyTrackHints(tracks, request.trackHints)
          const audio = namedTracks.filter((track) => track.type === 'AUDIO')
          const textTracks = namedTracks.filter((track) => track.type === 'TEXT')
          const embedded = textTracks.map((track): SubtitleChoice => ({
            id: `embedded-${track.index}`,
            label: track.label,
            kind: 'embedded',
            index: track.index,
          }))
          setAudioTracks(audio)
          setSubtitleChoices([offSubtitle, ...externalChoices, ...embedded])
          if (audio.length && appliedAudioPreferenceRef.current !== request.sessionId) {
            const selected = preferredTrack(audio, request.trackPreferences?.audio) ?? audio[0]
            void avplayRef.current.selectTrack('AUDIO', selected.index).then((confirmed) => {
              setActiveAudio(confirmed ? selected.index : avplayRef.current.currentTrackIndex('AUDIO') ?? selected.index)
            }).catch(() => { /* AVPlay retains its default track. */ })
            appliedAudioPreferenceRef.current = request.sessionId
          }
          if (appliedSubtitlePreferenceRef.current !== request.sessionId) {
            if (requestedSubtitle) {
              appliedSubtitlePreferenceRef.current = request.sessionId
            } else if (!request.trackPreferences?.subtitle) {
              appliedSubtitlePreferenceRef.current = request.sessionId
            } else {
              const selected = preferredTrack(textTracks, request.trackPreferences.subtitle)
              const choice = selected ? embedded.find((entry) => entry.index === selected.index) : undefined
              if (choice) {
                selectSubtitleChoice(choice)
                appliedSubtitlePreferenceRef.current = request.sessionId
              }
            }
          }
        },
        onLive: (isLive) => updatePlayer({ isLive }),
        onSubtitle: (text, durationMs) => {
          if (!activeSubtitleRef.current.startsWith('embedded-')) return
          setSubtitleText(text)
          if (subtitleTimerRef.current) window.clearTimeout(subtitleTimerRef.current)
          subtitleTimerRef.current = window.setTimeout(() => setSubtitleText(''), Math.max(500, durationMs || 3_000))
        },
        onComplete: () => {
          completedPlaybackRef.current?.()
        },
        onError: (message) => {
          if (tryNextCloudSource()) return
          setErrorMessage(message)
          publishStatus(true, message)
          setScreen('error')
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (tryNextCloudSource()) return
      setErrorMessage(message)
      publishStatus(true, message)
      setScreen('error')
    }
  }

  const handleControl = (command: CastControlRequest) => {
    if (command.action === 'status') publishStatus(true)
    else if (command.action === 'play') {
      avplayRef.current.play()
      updatePlayer({ state: 'playing' })
      setScreen('player')
      publishStatus(true)
    } else if (command.action === 'pause') {
      avplayRef.current.pause()
      updatePlayer({ state: 'paused' })
      publishStatus(true)
    } else if (command.action === 'seek' && Number.isFinite(command.positionSeconds)) {
      const position = Math.max(0, Number(command.positionSeconds))
      void avplayRef.current.seek(position).then(() => {
        updatePlayer({ position })
        publishStatus(true)
      })
    } else if (command.action === 'volume') {
      const audio = window.tizen?.tvaudiocontrol
      try {
        if (audio && command.volume != null) audio.setVolume(Math.round(Math.max(0, Math.min(1, command.volume)) * 100))
        if (audio && command.muted != null) audio.setMute(command.muted)
      } catch { /* Audio control is optional in the browser/emulator. */ }
      publishStatus(true)
    } else if (command.action === 'stop') {
      stopPlayback(paired ? 'home' : 'ready')
      if (command.exitApp) {
        // Let the terminal idle status reach the sender before Tizen tears down the application.
        window.setTimeout(() => {
          try { window.tizen?.application?.getCurrentApplication().exit() } catch { /* TV runtime only. */ }
        }, 100)
      }
    } else if (command.action === 'tracks') {
      const request = activeLoadRef.current
      const trackId = command.activeTrackIds?.[0]
      if (request && trackId != null) {
        const track = request.subtitles.find((entry, index) => (entry.id ?? index + 1) === trackId)
        if (track) selectSubtitleChoice({
          id: `external-${trackId}`,
          label: subtitleTrackLabel(track.title, track.lang, Math.max(0, trackId - 1)),
          kind: 'external',
          url: track.url,
          contentType: track.contentType,
        })
      } else selectSubtitleChoice(offSubtitle)
      publishStatus(true)
    }
  }

  useEffect(() => {
    registerRemoteKeys()
    const onProfilesChanged = () => {
      setProfilesOpen(!tvProfileReady())
      if (!tvProfileReady()) {
        if (activeLoadRef.current) stopPlayback('home')
        closeTrailer()
      }
    }
    window.addEventListener(PROFILES_CHANGED, onProfilesChanged)
    if (showPreviewTools) settleStartupAfterPaint()
    const receiver = new CompanionReceiver({
      onConnection: setConnected,
      onPaired: setPaired,
      onPairingInfo: setPairing,
      onSnapshot: (next) => {
        const pendingCatalog = catalogRequestRef.current
        if (pendingCatalog && next.catalog.screen !== pendingCatalog.screen) return
        const currentCinematicDestination = (['trending', 'series-home', 'movies'] as ScreenName[]).includes(screenRef.current)
          ? screenRef.current as CinematicDestination
          : 'home'
        const destination = pendingCatalog?.destination
          ?? (currentCinematicDestination === 'trending' && !isMergedCatalog(next) ? 'home' : currentCinematicDestination)
        const completedCatalogRequest = Boolean(pendingCatalog && next.catalog.screen === pendingCatalog.screen)
        if (completedCatalogRequest && pendingCatalog) {
          window.clearTimeout(pendingCatalog.timer)
          catalogRequestRef.current = undefined
          showNotice(`${pendingCatalog.label} catalogue loaded`)
        }
        setSnapshot(next)
        homeRowIndexesRef.current = {}
        heroIndexRef.current = 0
        setHeroIndex(0)
        const displaySnapshot = cinematicSnapshotFor(next, destination)
        setSelected(displaySnapshot.hero ?? displaySnapshot.rows[0]?.items[0] ?? fallbackMedia)
        setFocusLocation({ zone: 'hero', index: 0 })
        setActiveNav(navIndexFor(destination))
        setScreen(destination)
        if (completedCatalogRequest) finishNavigationTransition()
        settleStartupAfterPaint()
      },
      onPlaybackProgress: setSnapshot,
      onCatalogError: (catalogScreen, message) => {
        const pendingCatalog = catalogRequestRef.current
        if (!pendingCatalog || pendingCatalog.screen !== catalogScreen) return
        window.clearTimeout(pendingCatalog.timer)
        catalogRequestRef.current = undefined
        finishNavigationTransition()
        setActiveNav(0)
        setScreen('home')
        setCatalogMenuOpen(true)
        setCatalogMenuFocus(pendingCatalog.previousIndex)
        setFocusLocation({ zone: 'catalog', index: pendingCatalog.previousIndex })
        showNotice(message)
      },
      onSearchResults: (query, items, error, person, genre) => {
        if (query.trim().toLowerCase() !== searchQueryRef.current.trim().toLowerCase()) return
        const expected = searchPersonRef.current
        if (Boolean(expected) !== Boolean(person)
          || expected && person && (expected.provider !== person.provider || expected.id !== person.id || expected.credit !== person.credit)) return
        if ((searchGenreRef.current ?? '') !== (genre ?? '')) return
        if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
        setRemoteSearchResults(items)
        setSearchPending(false)
        setSearchError(error ?? '')
        if (searchPersonRef.current && items.length) setFocusLocation({ zone: 'grid', index: 0 })
      },
      onLoad: (request) => {
        setSourceChoices([])
        setDeviceSourceOptions(undefined)
        setActiveSourceId(undefined)
        if (request.media) setSelected(request.media)
        void startAvPlay(request)
      },
      onControl: handleControl,
      onDeviceSourceAvailability: setDeviceSourceChangeAvailable,
      onIndependentPlaybackReady: (ready) => {
        setIndependentPlaybackReady(ready)
        if (ready && screenRef.current === 'independent-setup') setIndependentSetupPhase('ready')
      },
      onWorkerSetupStatus: (status, message) => {
        if (status === 'opened' || status === 'starting') setIndependentSetupPhase('waiting')
        else if (status === 'dismissed') {
          setIndependentSetupPhase('intro')
          showNotice('Setup was closed on the linked device')
        } else {
          setIndependentSetupError(message || 'The linked device could not open setup.')
          setIndependentSetupPhase('error')
        }
      },
      onDeviceSourceOptions: (options) => {
        setDeviceSourceOptions(options)
        setPlayerMenu('source')
        setPlayerMenuFocus(0)
        if (options.error) showNotice(options.error)
        else if (!options.resolving && !options.choices.length) showNotice('The linked device found no playable sources.')
      },
    })
    receiverRef.current = receiver
    void receiver.connect().then(
      () => {
        if (!paired) settleStartupAfterPaint()
        else if (!startupSettledRef.current) {
          receiver.requestRefresh()
          startupFallbackTimerRef.current = window.setTimeout(settleStartupAfterPaint, 4_000)
        }
      },
      (error) => {
        if (!showPreviewTools) {
          setErrorMessage(error instanceof Error ? error.message : 'The Samsung receiver service is unavailable.')
          setScreen('error')
        }
        settleStartupAfterPaint()
      },
    )
    const statusTimer = window.setInterval(() => {
      if (!activeLoadRef.current) return
      if (avplayRef.current.available) {
        updatePlayer({ position: pendingSeekRef.current ?? avplayRef.current.currentTime(), duration: avplayRef.current.duration() })
      }
      publishStatus()
    }, 1_000)
    const flushPlaybackStatus = () => publishStatus(true)
    const flushHiddenPlaybackStatus = () => {
      if (document.visibilityState === 'hidden') flushPlaybackStatus()
    }
    window.addEventListener('pagehide', flushPlaybackStatus)
    window.addEventListener('beforeunload', flushPlaybackStatus)
    document.addEventListener('visibilitychange', flushHiddenPlaybackStatus)
    return () => {
      window.clearInterval(statusTimer)
      window.removeEventListener(PROFILES_CHANGED, onProfilesChanged)
      window.removeEventListener('pagehide', flushPlaybackStatus)
      window.removeEventListener('beforeunload', flushPlaybackStatus)
      document.removeEventListener('visibilitychange', flushHiddenPlaybackStatus)
      if (subtitleTimerRef.current) window.clearTimeout(subtitleTimerRef.current)
      if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
      if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
      if (navigationExitTimerRef.current) window.clearTimeout(navigationExitTimerRef.current)
      if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
      if (postPlayTransitionTimerRef.current) window.clearTimeout(postPlayTransitionTimerRef.current)
      if (catalogRequestRef.current) window.clearTimeout(catalogRequestRef.current.timer)
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
      if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
      if (startupSettleFrameRef.current) window.cancelAnimationFrame(startupSettleFrameRef.current)
      if (startupFallbackTimerRef.current) window.clearTimeout(startupFallbackTimerRef.current)
      receiver.disconnect()
      avplayRef.current.close()
    }
  }, [])

  useEffect(() => {
    if (!pairing) return
    let cancelled = false
    void QRCode.toDataURL(pairing.link, {
      width: 260,
      margin: 1,
      color: { dark: '#050505', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }).then((value) => { if (!cancelled) setQrCode(value) })
    return () => { cancelled = true }
  }, [pairing?.link])

  useEffect(() => {
    if (screen !== 'standalone-link') return
    if (previewParameters.has('capture')) {
      const confirming = previewParameters.get('scenario') === 'tv-link-confirming'
      setTvLinkInfo({
        code: 'ABCD2345',
        linkSecret: 'abcdefghijklmnopqrstuv',
        expiresAt: Date.now() + 10 * 60_000,
        phase: confirming ? 'confirming' : 'waiting',
        confirmation: confirming ? '418209' : undefined,
        message: confirming ? 'Compare this number with your phone, then approve it here.' : 'Scan the QR code or enter the TV code on your phone.',
      })
      return
    }
    const receiver = receiverRef.current
    if (!receiver) {
      setTvLinkInfo({ code: '', expiresAt: 0, phase: 'error', message: 'The TV receiver is still starting. Go back and try again.' })
      return
    }
    const link = new TvLinkReceiver(receiver.pairingInfo.deviceId, {
      onInfo: (info) => {
        setTvLinkInfo(info)
        if (info.phase === 'confirming') setFocus({ zone: 'setting', index: 0 })
      },
      onSetup: (transport) => {
        const activeReceiver = receiverRef.current
        if (!activeReceiver) throw new Error('The TV receiver closed before setup completed.')
        activeReceiver.adoptStandaloneTransport(transport)
        setPaired(true)
      },
    })
    tvLinkReceiverRef.current = link
    link.start()
    return () => {
      link.stop()
      if (tvLinkReceiverRef.current === link) tvLinkReceiverRef.current = undefined
    }
  }, [screen])

  useEffect(() => {
    if (!tvLinkInfo.code || !tvLinkInfo.linkSecret) {
      setStandaloneQrCode(undefined)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(tvLinkUrl(tvLinkInfo.code, tvLinkInfo.linkSecret), {
      width: 420,
      margin: 2,
      color: { dark: '#050505', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    }).then((value) => { if (!cancelled) setStandaloneQrCode(value) })
    return () => { cancelled = true }
  }, [tvLinkInfo.code, tvLinkInfo.linkSecret])

  useEffect(() => {
    const nativeVideo = avplayRef.current.available
    const miniPlayer = screen === 'postplay' && playbackSettings.postPlayExperienceEnabled && nativeVideo && Boolean(activeLoadRef.current)
    document.body.classList.toggle('avplay-visible', screen === 'player' && nativeVideo)
    document.body.classList.toggle('avplay-mini', miniPlayer)
    if (nativeVideo) {
      if (miniPlayer) avplayRef.current.setDisplayRect(76, 86, 920, 518)
      else avplayRef.current.setDisplayRect(0, 0, 1920, 1080)
    }
  }, [screen, playbackSettings.postPlayExperienceEnabled])

  useEffect(() => {
    if (screen !== 'player') {
      if (playerControlsTimerRef.current) window.clearTimeout(playerControlsTimerRef.current)
      return
    }
    revealPlayerControls(player.state !== 'playing' || playerToolsActive || playerPromptFocus === 'timeline' || Boolean(playerMenu))
  }, [screen, player.state, playerToolsActive, playerPromptFocus, playerMenu])

  useEffect(() => {
    searchQueryRef.current = searchQuery
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
    if (showPreviewTools || screen !== 'search' || !searchQuery.trim()) {
      setSearchPending(false)
      setSearchError('')
      setRemoteSearchResults(undefined)
      return
    }
    setRemoteSearchResults(undefined)
    setSearchError('')
    setSearchPending(true)
    const requestedQuery = searchQuery.trim()
    searchTimerRef.current = window.setTimeout(() => {
      if (!receiverRef.current?.requestSearch(requestedQuery, searchPerson, searchGenre)) {
        setSearchPending(false)
        setSearchError('Open izumi on the paired device to search this catalogue.')
        return
      }
      searchResponseTimerRef.current = window.setTimeout(() => {
        if (searchQueryRef.current.trim() !== requestedQuery) return
        setSearchPending(false)
        setSearchError('The paired device did not answer. Try again when izumi is open.')
      }, 7_000)
    }, 280)
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
      if (searchResponseTimerRef.current) window.clearTimeout(searchResponseTimerRef.current)
    }
  }, [searchQuery, searchPerson, searchGenre, screen, showPreviewTools])

  useEffect(() => {
    const playerController = avplayRef.current
    const onVisibility = () => {
      document.documentElement.classList.toggle('is-document-hidden', document.hidden)
      if (document.hidden) playerController.suspend()
      else void playerController.restore()
    }
    document.documentElement.classList.toggle('is-document-hidden', document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      document.documentElement.classList.remove('is-document-hidden')
    }
  }, [])

  useEffect(() => {
    const element = document.querySelector<HTMLElement>(`[data-focus-id="${focusId(focus)}"]`)
    if (!element || ['ready', 'loading', 'player', 'postplay', 'error'].includes(screen)) return
    const previous = appliedFocusRef.current
    appliedFocusRef.current = { focus, screen }
    if (document.activeElement !== element) {
      try { element.focus({ preventScroll: true }) }
      catch { element.focus() }
    }
    // Chromium 56 accepts the focus options object but ignores preventScroll. During the Home
    // entrance animation it can otherwise scroll the hidden 1080p root to center the incoming
    // rail, leaving every settled row above the physical TV viewport.
    if (['home', 'trending', 'series-home', 'movies'].includes(screen)) {
      const home = element.closest<HTMLElement>('.home-screen')
      const track = element.closest<HTMLElement>('.home-motion-track')
      if (home) {
        home.scrollTop = 0
        home.scrollLeft = 0
      }
      if (track) {
        track.scrollTop = 0
        track.scrollLeft = 0
      }
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
    }
    markFocusApplied(focusId(focus))
    if (focus.zone === 'grid') {
      const gridScroller = element.closest<HTMLElement>('.browse-catalog, .search-results')
      const columns = screen === 'search' ? 4 : 6
      const gridRowChanged = previous?.screen !== screen
        || previous.focus.zone !== 'grid'
        || Math.floor(previous.focus.index / columns) !== Math.floor(focus.index / columns)
      if (gridScroller && gridRowChanged) {
        const bounds = element.getBoundingClientRect()
        const container = gridScroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 20) animateScroll(gridScroller, 'scrollTop', gridScroller.scrollTop + bounds.bottom - container.bottom + 28)
        else if (bounds.top < container.top + 20) animateScroll(gridScroller, 'scrollTop', Math.max(0, gridScroller.scrollTop + bounds.top - container.top - 24))
      }
    }
    if (focus.zone === 'episode') {
      const scroller = element.closest<HTMLElement>('.series-library-scroll')
      if (scroller) {
        const bounds = element.getBoundingClientRect()
        const container = scroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 12) animateScroll(scroller, 'scrollTop', scroller.scrollTop + bounds.bottom - container.bottom + 18, 240)
        else if (bounds.top < container.top + 12) animateScroll(scroller, 'scrollTop', Math.max(0, scroller.scrollTop + bounds.top - container.top - 18), 240)
      }
    }
    if (focus.zone === 'series-season') {
      const scroller = element.parentElement
      if (scroller) {
        const bounds = element.getBoundingClientRect()
        const container = scroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 8) animateScroll(scroller, 'scrollTop', scroller.scrollTop + bounds.bottom - container.bottom + 12, 190)
        else if (bounds.top < container.top + 8) animateScroll(scroller, 'scrollTop', Math.max(0, scroller.scrollTop + bounds.top - container.top - 12), 190)
      }
    }
    if (focus.zone === 'relation') {
      const scroller = element.parentElement
      if (scroller) {
        const bounds = element.getBoundingClientRect()
        const container = scroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 12) animateScroll(scroller, 'scrollTop', scroller.scrollTop + bounds.bottom - container.bottom + 18, 210)
        else if (bounds.top < container.top + 12) animateScroll(scroller, 'scrollTop', Math.max(0, scroller.scrollTop + bounds.top - container.top - 18), 210)
      }
    }
    if (focus.zone === 'setting') {
      const scroller = element.closest<HTMLElement>('.settings-panel')
      if (scroller) {
        const bounds = element.getBoundingClientRect()
        const container = scroller.getBoundingClientRect()
        if (bounds.bottom > container.bottom - 10) animateScroll(scroller, 'scrollTop', scroller.scrollTop + bounds.bottom - container.bottom + 16, 180)
        else if (bounds.top < container.top + 10) animateScroll(scroller, 'scrollTop', Math.max(0, scroller.scrollTop + bounds.top - container.top - 16), 180)
      }
    }
  // Presentation-only replies replace row arrays while the viewer remains on the same tile. They
  // must not retrigger DOM focus, layout reads, and Chromium 56's scroll correction four times per
  // prefetch batch. A catalogue revision still restores focus when the actual DOM is replaced.
  }, [focus, focusRestoreEpoch, screen, snapshot.revision])

  useEffect(() => {
    const positions = pendingNavigationScrollRef.current
    if (!positions) return
    pendingNavigationScrollRef.current = undefined
    const frame = window.requestAnimationFrame(() => {
      positions.forEach(({ selector, left, top }) => {
        const element = document.querySelector<HTMLElement>(selector)
        if (!element) return
        const activeAnimation = dpadScrollAnimations.get(element)
        if (activeAnimation !== undefined) {
          window.cancelAnimationFrame(activeAnimation)
          dpadScrollAnimations.delete(element)
        }
        element.scrollLeft = left
        element.scrollTop = top
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusRestoreEpoch, screen])

  useEffect(() => {
    if (!showPreviewTools || screen !== 'player' || player.state !== 'playing' || activeLoadRef.current) return
    const timer = window.setInterval(() => {
      const view = playerRef.current
      const position = Math.min(view.duration, view.position + 1)
      updatePlayer({ position })
      playbackTimeRef.current?.(position, view.duration)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [screen, player.state, showPreviewTools])

  useEffect(() => {
    writePlaybackExperienceSettings(playbackSettings)
  }, [playbackSettings])

  useEffect(() => {
    if (!nextEpisodeVisible
      || nextEpisodeDismissed
      || !upcomingEpisode
      || !playbackSettings.autoplayNextEpisode
      || stillWatching) {
      setNextCountdown(undefined)
      return
    }
    let remaining = 10
    setNextCountdown(remaining)
    const timer = window.setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        window.clearInterval(timer)
        setNextCountdown(undefined)
        playNextEpisodeRef.current?.()
      } else setNextCountdown(remaining)
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [nextEpisodeVisible, nextEpisodeDismissed, playbackSettings.autoplayNextEpisode, stillWatching, playbackMedia])

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2_600)
  }

  const openDetails = (media: CompanionMedia) => {
    closeTrailer()
    pushCurrentNavigation()
    setSelected(media)
    setFocusLocation({ zone: 'detail', index: 0 })
    setScreen('details')
    requestMediaDetails(media)
  }

  const closeTrailer = () => {
    trailerGenerationRef.current += 1
    const source = trailerSourceRef.current
    if (source?.requestId) receiverRef.current?.releaseTrailer(source.requestId)
    trailerSourceRef.current = undefined
    setTrailerSource(undefined)
    setTrailerError('')
    setTrailerOpen(false)
  }

  const openTrailer = (media: CompanionMedia) => {
    const videoId = youtubeTrailerId(media)
    if (!videoId) {
      showNotice('This trailer is unavailable.')
      return
    }
    closeTrailer()
    const generation = ++trailerGenerationRef.current
    setTrailerOpen(true)
    if (showPreviewTools) {
      const params = new URLSearchParams({
        autoplay: '1', controls: '0', disablekb: '1', enablejsapi: '1', playsinline: '1', rel: '0',
        cc_load_policy: '0', hl: 'en', iv_load_policy: '3',
      })
      if (/^https?:$/i.test(location.protocol)) params.set('origin', location.origin)
      const source = { url: `https://www.youtube-nocookie.com/embed/${videoId}?${params}` }
      trailerSourceRef.current = source
      setTrailerSource(source)
      return
    }
    const receiver = receiverRef.current
    if (!receiver) {
      setTrailerError('Open izumi on the paired device to play this trailer.')
      return
    }
    void receiver.requestTrailer(videoId, `${media.title} trailer`).then((source) => {
      if (generation !== trailerGenerationRef.current) {
        receiver.releaseTrailer(source.requestId)
        return
      }
      trailerSourceRef.current = source
      setTrailerSource(source)
    }).catch((error) => {
      if (generation !== trailerGenerationRef.current) return
      setTrailerError(error instanceof Error ? error.message : 'The paired device could not prepare this trailer.')
    })
  }

  const closeDetails = () => {
    if (!restorePreviousNavigation()) restoreHomeNavigation()
  }

  // Focus moves many times per second on a remote. None of these catalogue/search projections
  // depend on focus, so keep their arrays stable until the paired device sends a new snapshot.
  const cinematicScreen = ['home', 'trending', 'series-home', 'movies'].includes(screen)
  useEffect(() => {
    const changed = () => setSnapshot(value => ({ ...value }))
    window.addEventListener(DISCOVERY_CHANGED, changed)
    return () => window.removeEventListener(DISCOVERY_CHANGED, changed)
  }, [])
  const collections = useMemo(() => catalogCollections(snapshot), [snapshot])
  const homeRows = useMemo(() => orderedHomeRows(snapshot.rows), [snapshot.rows])
  const browseRows = useMemo(() => browseCategoryRows(snapshot), [snapshot])
  const homeSnapshot = useMemo(() => ({ ...snapshot, rows: homeRows }), [snapshot, homeRows])
  const browseSnapshot = useMemo(() => ({ ...snapshot, rows: browseRows }), [snapshot, browseRows])
  const seriesHomeSnapshot = useMemo(() => homeSnapshotForKind(homeSnapshot, 'show'), [homeSnapshot])
  const movieHomeSnapshot = useMemo(() => homeSnapshotForKind(homeSnapshot, 'movie'), [homeSnapshot])
  const cinematicSnapshot = screen === 'trending' ? browseSnapshot
    : screen === 'series-home' ? seriesHomeSnapshot
      : screen === 'movies' ? movieHomeSnapshot
        : homeSnapshot
  const cinematicRows = cinematicSnapshot.rows
  const heroRailSnapshot = screen === 'trending' ? snapshot : cinematicSnapshot
  const homeHeroRail = useMemo(() => homeHeroItems(heroRailSnapshot), [heroRailSnapshot])
  const focusedHomeSource = cinematicScreen && focus.zone === 'row'
    ? cinematicRows[focus.row]?.items[focus.index]
    : undefined
  const focusedHomeMediaKey = focusedHomeSource ? homeMediaKey(focusedHomeSource) : ''
  const focusedHomeDetails = focusedHomeMediaKey
    ? homePresentationCacheRef.current.get(focusedHomeMediaKey)
    : undefined
  // Prefetch replies stay outside the large Home snapshot. The next D-pad render reads its cached
  // presentation synchronously, avoiding background whole-page reconciles while the viewer moves.
  const renderedCinematicSnapshot = focusedHomeDetails
    ? mergeHomeMediaDetails(cinematicSnapshot, focusedHomeDetails)
    : cinematicSnapshot
  const focusedHomeMedia = cinematicScreen && focus.zone === 'row'
    ? renderedCinematicSnapshot.rows[focus.row]?.items[focus.index]
    : undefined
  const homePreviewMedia = focus.zone === 'hero' ? selected : focusedHomeMedia
  const homePreviewMediaKey = homePreviewMedia
    ? `${homePreviewMedia.ref.provider}:${homePreviewMedia.ref.type}:${homePreviewMedia.ref.id}`
    : ''
  const homePrefetchMedia = useMemo(
    () => cinematicScreen ? homeDetailPrefetchTargets(cinematicRows, focus, homeRowIndexesRef.current) : [],
    [cinematicRows, cinematicScreen, focus],
  )

  const warmHomeArtwork = (media: CompanionMedia) => {
    // App-level detail requests prioritize the lightweight title treatment. HomeScreen separately
    // budgets the expensive backdrop decodes according to actual D-pad destinations.
    preloadHomeMedia(media, media.placement?.kind === 'continue')
  }

  const cacheHomePresentation = (media: CompanionMedia) => {
    const key = homeMediaKey(media)
    const cache = homePresentationCacheRef.current
    cache.delete(key)
    cache.set(key, media)
    while (cache.size > HOME_PRESENTATION_CACHE_LIMIT) {
      const oldest = cache.keys().next().value as string | undefined
      if (!oldest) break
      cache.delete(oldest)
    }
  }

  const pumpHomeDetailQueue = () => {
    while (homeDetailActiveRef.current < HOME_DETAIL_CONCURRENCY && homeDetailQueueRef.current.length) {
      const task = homeDetailQueueRef.current.shift()!
      if (task.generation !== homeDetailGenerationRef.current) continue
      homeDetailActiveRef.current += 1
      warmHomeArtwork(task.media)
      const receiver = receiverRef.current
      const request = task.preview
        ? Promise.resolve(previewDetailsFor(task.media))
        : receiver ? receiver.requestDetails(task.media, true) : Promise.resolve(null)
      void request.then((result) => {
        if (task.generation !== homeDetailGenerationRef.current) return
        const settled = result
          ? { ...result, titleArtSettled: true }
          : { ...task.media, titleArtSettled: true }
        warmHomeArtwork(settled)
        cacheHomePresentation(settled)
        // The hero/carousel reads `selected`; update only that one visible title. Background rail
        // replies remain ref-only and therefore cannot interrupt D-pad rendering.
        setSelected((current) => sameMedia(settled, current) ? settled : current)
      }).catch(() => {
        if (task.generation !== homeDetailGenerationRef.current) return
        cacheHomePresentation({ ...task.media, titleArtSettled: true })
      }).finally(() => {
        if (task.generation === homeDetailGenerationRef.current) homeDetailActiveRef.current -= 1
        pumpHomeDetailQueue()
      })
    }
  }

  const queueHomeDetails = (media: CompanionMedia[]) => {
    const generation = homeDetailGenerationRef.current
    const existing = new Map(homeDetailQueueRef.current.map((task) => [
      homeMediaKey(task.media),
      task,
    ]))
    const prioritized: HomeDetailTask[] = []
    const priorityKeys = new Set<string>()
    for (const item of media) {
      warmHomeArtwork(item)
      const key = homeMediaKey(item)
      if (priorityKeys.has(key)) continue
      priorityKeys.add(key)
      if (item.titleArtSettled || homePresentationCacheRef.current.has(key)) continue
      const queued = existing.get(key)
      if (queued) {
        prioritized.push(queued)
        continue
      }
      if (homeDetailRequestsRef.current.has(key)) continue
      homeDetailRequestsRef.current.add(key)
      homeDetailRequestOrderRef.current.push(key)
      while (homeDetailRequestOrderRef.current.length > 64) {
        const expired = homeDetailRequestOrderRef.current.shift()
        if (expired) homeDetailRequestsRef.current.delete(expired)
      }
      prioritized.push({ media: item, generation, preview: showPreviewTools })
    }
    const stale = homeDetailQueueRef.current.filter((task) => {
      const key = homeMediaKey(task.media)
      return !priorityKeys.has(key)
    })
    const nextQueue = [...prioritized, ...stale].slice(0, 12)
    const kept = new Set(nextQueue.map((task) => homeMediaKey(task.media)))
    for (const task of homeDetailQueueRef.current) {
      const key = homeMediaKey(task.media)
      if (!kept.has(key)) homeDetailRequestsRef.current.delete(key)
    }
    homeDetailQueueRef.current = nextQueue
    pumpHomeDetailQueue()
  }

  useEffect(() => {
    homeDetailGenerationRef.current += 1
    homeDetailRequestsRef.current.clear()
    homeDetailRequestOrderRef.current = []
    homeDetailQueueRef.current = []
    homeDetailActiveRef.current = 0
    homePresentationCacheRef.current.clear()
  }, [snapshot.revision])

  useEffect(() => {
    if (!cinematicScreen) return
    queueHomeDetails(homePreviewMedia ? [homePreviewMedia, ...homePrefetchMedia] : homePrefetchMedia)
  }, [cinematicScreen, homePrefetchMedia, homePreviewMediaKey, showPreviewTools])

  useEffect(() => {
    const generation = ++homeTrailerGenerationRef.current
    const previous = homeTrailerPreviewRef.current
    if (previous?.requestId) receiverRef.current?.releaseTrailer(previous.requestId)
    homeTrailerPreviewRef.current = undefined
    setHomeTrailerPreview(undefined)
    if (!playbackSettings.videoPreviewsEnabled) return
    const videoId = focusedHomeMedia ? youtubeTrailerId(focusedHomeMedia) : undefined
    if (!videoId || !focusedHomeMedia) return
    const captions = trailerNeedsEnglishCaptions(focusedHomeMedia.trailer?.language)

    const timer = window.setTimeout(() => {
      if (showPreviewTools) {
        const params = new URLSearchParams({
          autoplay: '1', controls: '0', disablekb: '1', enablejsapi: '1', playsinline: '1', rel: '0',
          mute: '0', cc_load_policy: captions ? '1' : '0', hl: 'en', iv_load_policy: '3',
        })
        if (captions) params.set('cc_lang_pref', 'en')
        if (/^https?:$/i.test(location.protocol)) params.set('origin', location.origin)
        const source = { mediaKey: focusedHomeMediaKey, url: `https://www.youtube-nocookie.com/embed/${videoId}?${params}` }
        homeTrailerPreviewRef.current = source
        setHomeTrailerPreview(source)
        return
      }
      const receiver = receiverRef.current
      if (!receiver) return
      void receiver.requestTrailer(videoId, `${focusedHomeMedia.title} home preview`, false, captions).then((result) => {
        if (generation !== homeTrailerGenerationRef.current) {
          receiver.releaseTrailer(result.requestId)
          return
        }
        const source = { mediaKey: focusedHomeMediaKey, ...result }
        homeTrailerPreviewRef.current = source
        setHomeTrailerPreview(source)
      }).catch(() => {
        // Artwork remains visible when a provider or paired device cannot prepare the trailer.
      })
    }, 1_500)

    return () => window.clearTimeout(timer)
  }, [focusedHomeMediaKey, focusedHomeMedia?.title, focusedHomeMedia?.trailer?.id, focusedHomeMedia?.trailer?.site, focusedHomeMedia?.trailer?.language, playbackSettings.videoPreviewsEnabled, screen, showPreviewTools])
  const allMedia = collections.search
  const postPlayItems = useMemo(() => postPlayRecommendations(postPlayMedia, allMedia), [postPlayMedia, allMedia])
  const ratingFor = (media: CompanionMedia): MediaRating | undefined => mediaRatings[mediaRatingKey(media)]?.value
  const rateMedia = (media: CompanionMedia, value: MediaRating, toggle = true) => {
    setMediaRatings((current) => {
      if (!toggle && current[mediaRatingKey(media)]?.value === value) return current
      return writeMediaRating(current, media, value)
    })
  }
  const enterPostPlay = (media: CompanionMedia) => {
    if (postPlayPresentedRef.current) return
    postPlayPresentedRef.current = true
    setPostPlayMedia(media)
    setPostPlayStage('rating')
    setPostPlayRatingTransitioning(false)
    setPostPlayFocus(1)
    setScreen('postplay')
  }
  const answerPostPlayRating = (value: MediaRating) => {
    if (postPlayRatingTransitioning) return
    rateMedia(postPlayMedia, value, false)
    setPostPlayRatingTransitioning(true)
    if (postPlayTransitionTimerRef.current) window.clearTimeout(postPlayTransitionTimerRef.current)
    postPlayTransitionTimerRef.current = window.setTimeout(() => {
      setPostPlayRatingTransitioning(false)
      setPostPlayStage('recommendations')
      setPostPlayFocus(postPlayItems.length ? 3 : 1)
    }, 440)
  }
  const returnToPostPlayPlayer = () => {
    if (postPlayTransitionTimerRef.current) window.clearTimeout(postPlayTransitionTimerRef.current)
    setPostPlayRatingTransitioning(false)
    avplayRef.current.setDisplayRect(0, 0, 1920, 1080)
    if (playbackEndedRef.current && activeLoadRef.current) {
      const replayFrom = Math.max(0, playerRef.current.duration - 45)
      playbackEndedRef.current = false
      void startAvPlay({ ...activeLoadRef.current, positionSeconds: replayFrom })
      return
    }
    setPlayerControlsVisible(true)
    setScreen('player')
  }
  const normalizedSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const localSearchResults = useMemo(() => allMedia.filter((item) => {
    if (searchGenre) return (item.genres ?? []).some((genre) => genre.toLowerCase() === searchGenre.toLowerCase())
    const searchable = [item.title, item.subtitle, item.placement?.label, ...(item.genres ?? [])].filter(Boolean).join(' ').toLowerCase()
    return !normalizedSearch || searchable.includes(normalizedSearch)
  }), [allMedia, normalizedSearch, searchGenre])
  const searchResults = normalizedSearch && remoteSearchResults !== undefined ? remoteSearchResults : localSearchResults
  const searchSuggestions = useMemo(() => {
    const pool = Array.from(new Set([
      ...(snapshot.catalog.genres ?? []),
      ...allMedia.flatMap((item) => item.genres ?? []),
    ].map((value) => value.trim()).filter(Boolean)))
    return pool
      .filter((value) => !normalizedSearch || value.toLowerCase().includes(normalizedSearch))
      .sort((left, right) => {
        if (!normalizedSearch) return left.localeCompare(right)
        return Number(right.toLowerCase().startsWith(normalizedSearch)) - Number(left.toLowerCase().startsWith(normalizedSearch)) || left.localeCompare(right)
      })
      .slice(0, 7)
  }, [allMedia, normalizedSearch, snapshot.catalog.genres])
  const trendingItems = collections.trending
  const seriesItems = collections.series
  const movieItems = collections.movies
  const myListItems = collections.myList
  const watchHistoryItems = collections.history
  const catalogOptions = useMemo(() => snapshot.catalog.options?.length
    ? snapshot.catalog.options
    : [{ screen: snapshot.catalog.screen, label: snapshot.catalog.label }], [snapshot])

  const showHomeHero = (index: number) => {
    const item = homeHeroRail[index]
    if (!item) return
    const artwork = item.episodeImage || item.backdrop || item.poster
    if (artwork) {
      const image = new Image()
      image.src = artwork
    }
    heroIndexRef.current = index
    setHeroIndex(index)
    setSelected(item)
    lastHomeContentFocusRef.current = { zone: 'hero', index }
    setFocusLocation({ zone: 'hero', index })
  }

  const stepHomeHero = (direction: -1 | 1) => {
    if (homeHeroRail.length < 2) return
    showHomeHero(wrappedHeroIndex(heroIndexRef.current, direction, homeHeroRail.length))
  }

  useEffect(() => {
    if (!cinematicScreen || focus.zone !== 'hero' || catalogMenuOpen || homeHeroRail.length < 2) return
    const timer = window.setTimeout(() => stepHomeHero(1), 15_000)
    return () => window.clearTimeout(timer)
  }, [catalogMenuOpen, cinematicScreen, focus.zone, heroIndex, homeHeroRail])

  const changeFocus = (next: FocusLocation) => {
    if (focusId(focusRef.current) === focusId(next)) return
    if (next.zone === 'row') {
      const row = cinematicRows[next.row]
      if (row) {
        const index = Math.max(0, Math.min(row.items.length - 1, next.index))
        homeRowIndexesRef.current[row.id] = index
        if (cinematicScreen && playbackSettings.homeCarouselLayout && row.items[index]) setSelected(row.items[index])
      }
    }
    setFocusLocation(next)
  }

  const changeSearchKeyFocus = (index: number, preserveColumn = false) => {
    const alreadyCurrent = focusRef.current.zone === 'keyboard' && focusRef.current.index === index
    if (!preserveColumn && !alreadyCurrent) searchKeyboardColumnRef.current = SEARCH_KEYS[index]?.column ?? 0
    changeFocus({ zone: 'keyboard', index })
  }

  const openCatalogMenu = () => {
    const selectedIndex = Math.max(0, catalogOptions.findIndex((option) => option.screen === snapshot.catalog.screen))
    if (screen !== 'home') {
      heroIndexRef.current = 0
      setHeroIndex(0)
      setSelected(snapshot.hero ?? snapshot.rows[0]?.items[0] ?? fallbackMedia)
      lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
    }
    setActiveNav(0)
    setScreen('home')
    setCatalogMenuOpen(true)
    setCatalogMenuFocus(selectedIndex)
    changeFocus({ zone: 'catalog', index: selectedIndex })
  }

  const closeCatalogMenu = () => {
    setCatalogMenuOpen(false)
    changeFocus({ zone: 'nav', index: -1 })
  }

  const enterCinematicDestination = (
    destination: CinematicDestination,
    nextSnapshot: CompanionHomeSnapshot = snapshot,
  ) => {
    const displaySnapshot = cinematicSnapshotFor(nextSnapshot, destination)
    homeRowIndexesRef.current = {}
    heroIndexRef.current = 0
    setHeroIndex(0)
    setSelected(displaySnapshot.hero ?? displaySnapshot.rows[0]?.items[0] ?? fallbackMedia)
    lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
    setCatalogMenuOpen(false)
    setActiveNav(navIndexFor(destination))
    setScreen(destination)
    changeFocus({ zone: 'hero', index: 0 })
  }

  const requestCatalogOption = (
    option: CompanionCatalogOption,
    destination: 'home' | 'trending',
  ) => {
    if (showPreviewTools) {
      const next = previewSnapshotForCatalog(option.screen)
      setSnapshot(next)
      enterCinematicDestination(destination, next)
      showNotice(`${option.label} catalogue loaded`)
      return
    }
    if (!receiverRef.current?.requestCatalog(option.screen)) {
      showNotice('Open izumi on the paired device to change catalogues')
      return
    }
    if (catalogRequestRef.current) window.clearTimeout(catalogRequestRef.current.timer)
    const timer = window.setTimeout(() => {
      if (catalogRequestRef.current?.screen !== option.screen) return
      catalogRequestRef.current = undefined
      finishNavigationTransition()
      if (destination === 'trending') enterCinematicDestination('home')
      showNotice(`${option.label} did not respond. Still showing ${snapshot.catalog.label}.`)
    }, 8_000)
    const previousIndex = Math.max(0, catalogOptions.findIndex((catalog) => catalog.screen === snapshot.catalog.screen))
    catalogRequestRef.current = { screen: option.screen, label: option.label, timer, previousIndex, destination }
    setCatalogMenuOpen(false)
    setActiveNav(navIndexFor(destination))
    setScreen(destination)
    if (destination === 'trending') changeFocus({ zone: 'hero', index: 0 })
    else changeFocus({ zone: 'nav', index: -1 })
    beginNavigationTransition(true)
    showNotice(`Switching to ${option.label}`)
  }

  const selectCatalogOption = (index: number) => {
    const option = catalogOptions[index]
    if (option) requestCatalogOption(option, 'home')
  }

  const moveHomeFocus = (action: RemoteAction) => {
    const focus = focusRef.current
    let next = focus
    if (focus.zone !== 'nav') lastHomeContentFocusRef.current = focus
    if (focus.zone === 'nav') {
      if (action === 'up') next = { zone: 'nav', index: Math.max(-1, focus.index - 1) }
      else if (action === 'down') next = { zone: 'nav', index: Math.min(navItemCount() - 1, focus.index + 1) }
      else if (action === 'right') {
        const previous = lastHomeContentFocusRef.current
        if (previous.zone === 'hero') {
          showHomeHero(Math.min(previous.index, Math.max(0, homeHeroRail.length - 1)))
          return
        }
        next = previous
      }
    } else if (focus.zone === 'hero') {
      if (action === 'left' || action === 'right') {
        stepHomeHero(action === 'left' ? -1 : 1)
        return
      }
      if (action === 'up') next = { zone: 'nav', index: activeNav }
      else if (action === 'down' && cinematicRows[0]?.items.length) {
        next = { zone: 'row', row: 0, index: rememberedHomeRowIndex(cinematicRows[0], homeRowIndexesRef.current) }
      }
    } else if (focus.zone === 'row') {
      const row = cinematicRows[focus.row]
      if (!row) return
      if (action === 'left') next = focus.index > 0
        ? { ...focus, index: focus.index - 1 }
        : { zone: 'nav', index: activeNav }
      else if (action === 'right') next = { ...focus, index: wrappedHeroIndex(focus.index, 1, row.items.length) }
      else if (action === 'up') {
        const upperRow = focus.row - 1
        if (upperRow < 0) {
          showHomeHero(heroIndexRef.current)
          return
        }
        next = {
          zone: 'row',
          row: upperRow,
          index: rememberedHomeRowIndex(cinematicRows[upperRow], homeRowIndexesRef.current),
        }
      } else if (action === 'down' && focus.row < cinematicRows.length - 1) {
        const lowerRow = focus.row + 1
        next = {
          zone: 'row',
          row: lowerRow,
          index: rememberedHomeRowIndex(cinematicRows[lowerRow], homeRowIndexesRef.current),
        }
      }
    }
    changeFocus(next)
  }

  const finishActivePlayback = () => {
    updatePlayer({ state: 'idle' })
    publishStatus(true)
    avplayRef.current.close()
    activeLoadRef.current = undefined
    receiverRef.current?.clearPlayback()
    externalSubtitlesRef.current.clear()
    setSubtitleText('')
    subtitleLoadGenerationRef.current += 1
    activeSubtitleRef.current = 'off'
    activeSubtitleLabelRef.current = ''
    subtitleStateRef.current = 'off'
    subtitleErrorRef.current = ''
    setPlayerMenu(null)
    setSourceChoices([])
    sourceChoicesRef.current = []
    failedCloudSourcesRef.current.clear()
    setDeviceSourceOptions(undefined)
    setActiveSourceId(undefined)
    playbackEndedRef.current = false
  }

  const playMedia = async (media: CompanionMedia, autoplay = false) => {
    const generation = ++playRequestGenerationRef.current
    if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
    if (activeLoadRef.current) finishActivePlayback()
    postPlayPresentedRef.current = false
    playbackEndedRef.current = false
    setPostPlayStage('rating')
    setPostPlayRatingTransitioning(false)
    pushCurrentNavigation()
    setSelected(media)
    setPlaybackMedia(media)
    setNextEpisodeVisible(false)
    setNextEpisodeDismissed(false)
    setNextCountdown(undefined)
    setVisibleSkipSegment(undefined)
    setStillWatching(false)
    if (autoplay) autoplayCountRef.current += 1
    setSourceChoices([])
    setActiveSourceId(undefined)
    setLoadingProgress(0)
    updatePlayer({ title: media.title, state: 'buffering', position: media.progress ? 523 : 0, duration: 1_422, isLive: false })
    setScreen('loading')
    if (showPreviewTools) {
      if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
      simulationTimerRef.current = window.setTimeout(() => {
        setLoadingProgress(100)
        updatePlayer({ state: 'playing' })
        setScreen('player')
      }, 900)
      return
    }
    const result = await receiverRef.current?.requestPlay(media) ?? 'open-client'
    if (generation !== playRequestGenerationRef.current) return
    if (typeof result !== 'string' && result.kind === 'failed') {
      setErrorMessage(result.message)
      setScreen('error')
    } else if (typeof result !== 'string') {
      setSourceChoices(result.sources)
      sourceChoicesRef.current = result.sources
      const preferred = playbackSettings.preferBingeSource && currentSourceLabelRef.current
        ? result.sources.find((source) => source.label.trim().toLowerCase() === currentSourceLabelRef.current.trim().toLowerCase())
        : undefined
      const selectedSource = preferred ?? result.sources.find((source) => source.id === result.selectedId)
      const request = selectedSource?.request ?? result.request
      const sourceId = selectedSource?.id ?? result.selectedId
      setActiveSourceId(sourceId)
      currentSourceLabelRef.current = selectedSource?.label ?? result.sources.find((source) => source.id === sourceId)?.label ?? ''
      await startAvPlay(request)
    } else if (result === 'open-client') {
      setErrorMessage('Open izumi on your linked device, then try again.')
      setScreen('error')
    } else if (result === 'queued') {
      setErrorMessage('The request is waiting in your private Worker, but phone notifications are not enrolled. Open izumi to continue.')
      setScreen('error')
    } else if (result === 'worker-error') {
      setErrorMessage('Your private izumi Worker could not be reached. Check its deployment and try again.')
      setScreen('error')
    } else if (result === 'no-source') {
      setErrorMessage('Your private Worker found no TV-playable source. Configure a debrid provider in izumi for torrent sources, or turn on the optional connected-device fallback.')
      setScreen('error')
    } else if (result === 'notified') {
      simulationTimerRef.current = window.setTimeout(() => {
        if (generation !== playRequestGenerationRef.current || activeLoadRef.current) return
        setErrorMessage('The phone did not finish this request before it expired. Try again from the TV.')
        setScreen('error')
      }, 5 * 60_000)
    }
  }

  const retryPlayback = () => {
    if (activeLoadRef.current) void startAvPlay(activeLoadRef.current)
    else if (paired) {
      if (!restorePreviousNavigation()) restoreHomeNavigation()
    } else {
      setScreen('ready')
      changeFocus({ zone: 'setting', index: 0 })
    }
  }

  const requestMediaDetails = (media: CompanionMedia) => {
    if (showPreviewTools) {
      setSelected((current) => sameMedia(current, media) ? previewDetailsFor(media) : current)
      return
    }
    void receiverRef.current?.requestDetails(media).then((details) => {
      if (!details) return
      setSelected((current) => sameMedia(current, media) ? details : current)
    })
  }

  const openSeries = (media: CompanionMedia) => {
    closeTrailer()
    pushCurrentNavigation()
    setSelected(media)
    const seasonCounts = episodeCountsFor(media)
    const initialSeason = seasonCounts.length > 1
      ? seasonIndexFor(media, media.season ?? 1, seasonCounts)
      : 0
    setSeriesSeason(initialSeason)
    setCatalogMenuOpen(false)
    setScreen('series')
    changeFocus(initialSeriesFocus())
    requestMediaDetails(media)
  }

  const initialSeriesFocus = (): FocusLocation => ({ zone: 'series-action', index: 0 })

  const selectCatalogMedia = (media: CompanionMedia) => {
    if (catalogMediaDestination(media) === 'details') openDetails(media)
    else openSeries(media)
  }

  const selectRelatedMedia = (media: CompanionMedia) => {
    if (media.ref.type === 'movie') openDetails(media)
    else openSeries(media)
  }

  const finishNavigationTransition = () => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
    if (navigationExitTimerRef.current) window.clearTimeout(navigationExitTimerRef.current)
    const minimumVisibleMs = 320
    const delay = Math.max(34, minimumVisibleMs - Math.max(0, tvNow() - navigationStartedAtRef.current))
    navigationTimerRef.current = window.setTimeout(() => {
      setNavigationPhase('leaving')
      navigationExitTimerRef.current = window.setTimeout(() => setNavigationPhase('idle'), 180)
    }, delay)
  }

  const openPersonSearch = (person: CompanionPerson) => {
    closeTrailer()
    pushCurrentNavigation()
    const query = person.name.trim().slice(0, 80)
    searchPersonRef.current = person
    searchQueryRef.current = query
    setSearchPerson(person)
    setSearchGenre(undefined)
    setSearchQuery(query)
    setRemoteSearchResults(undefined)
    setSearchError('')
    setSearchPending(true)
    setActiveNav(1)
    setScreen('search')
    changeFocus({ zone: 'search-input', index: 0 })
  }

  const beginNavigationTransition = (waitForData = false) => {
    if (navigationTimerRef.current) window.clearTimeout(navigationTimerRef.current)
    if (navigationExitTimerRef.current) window.clearTimeout(navigationExitTimerRef.current)
    navigationStartedAtRef.current = tvNow()
    setNavigationPhase('loading')
    if (!waitForData) navigationTimerRef.current = window.setTimeout(finishNavigationTransition, 520)
  }

  const selectNav = (index: number) => {
    if (index === navItemCount() - 1 && tvHousehold().enabled) { closeTrailer(); setProfilesOpen(true); return }
    if (index === -1) return openCatalogMenu()
    closeTrailer()
    clearNavigationHistory()
    setCatalogMenuOpen(false)
    setSettingsConfirmation(null)
    const destination = navDestinationAt(index)
    if (destination === 'trending') {
      if (isMergedCatalog(snapshot)) {
        if (destination !== screen) beginNavigationTransition()
        enterCinematicDestination('trending')
      } else requestCatalogOption(mergedCatalogOption(snapshot), 'trending')
      return
    }
    if (destination === 'home' || destination === 'series-home' || destination === 'movies') {
      if (destination !== screen) beginNavigationTransition()
      enterCinematicDestination(destination)
      return
    }
    setActiveNav(index)
    if (destination !== screen) beginNavigationTransition()
    setScreen(destination)
    if (destination === 'search') {
      setSearchPerson(undefined)
      setSearchGenre(undefined)
      changeSearchKeyFocus(0)
    }
    else if (destination === 'settings') changeFocus({ zone: 'setting', index: 0 })
    else {
      const items = browseItemsFor(destination)
      setSelected(items[0] ?? fallbackMedia)
      changeFocus({ zone: 'grid', index: 0 })
    }
  }

  const openVoiceSearch = (query?: string) => {
    const nextQuery = query?.trim() ?? ''
    closeTrailer()
    if (screenRef.current !== 'search') pushCurrentNavigation()
    setCatalogMenuOpen(false)
    setSettingsConfirmation(null)
    if (screenRef.current === 'player' || screenRef.current === 'loading') finishActivePlayback()
    if (screenRef.current !== 'search') beginNavigationTransition()
    setActiveNav(1)
    setScreen('search')
    setSearchPerson(undefined)
    setSearchGenre(undefined)
    if (nextQuery) {
      searchQueryRef.current = nextQuery
      setSearchQuery(nextQuery)
      setRemoteSearchResults(undefined)
    }
    changeFocus({ zone: 'search-input', index: 0 })
  }

  useEffect(() => installVoiceSearch(allMedia, {
    getScreen: () => screenRef.current,
    onOpenSearch: () => openVoiceSearch(),
    onSearch: openVoiceSearch,
  }), [snapshot.revision])

  const activateCurrentFocus = () => {
    const focus = focusRef.current
    if (focus.zone === 'nav') selectNav(focus.index)
    else if (focus.zone === 'hero') playMedia(selected)
    else if (focus.zone === 'row') {
      const row = cinematicRows[focus.row]
      const media = row?.items[focus.index]
      if (media) row.kind === 'continue' ? playMedia(media) : selectCatalogMedia(media)
    }
  }

  const showSeekFeedback = (direction: -1 | 1, multiplier: number) => {
    if (seekFeedbackTimerRef.current) window.clearTimeout(seekFeedbackTimerRef.current)
    setSeekFeedback({
      direction: direction > 0 ? 'forward' : 'backward',
      multiplier,
      seconds: PLAYER_SEEK_STEP_SECONDS * multiplier,
    })
    seekFeedbackTimerRef.current = window.setTimeout(() => setSeekFeedback(undefined), 700)
  }

  /** AVPlay treats each seek as asynchronous. Keep the UI immediate, but permit only one hardware
   * seek at a time and collapse every repeat event into the newest requested position. */
  const flushPendingSeek = (): void => {
    const target = pendingSeekRef.current
    if (target === undefined || seekInFlightRef.current || seekHoldActionRef.current) return
    if (!avplayRef.current.available) {
      pendingSeekRef.current = undefined
      return
    }
    seekInFlightRef.current = true
    const finish = () => {
      if (pendingSeekRef.current === target) pendingSeekRef.current = undefined
      seekInFlightRef.current = false
      if (pendingSeekRef.current !== undefined) flushPendingSeek()
    }
    void avplayRef.current.seek(target).then(() => {
      publishStatus(true)
      finish()
    }, finish)
  }

  const seekFromRemote = (direction: -1 | 1, multiplier = 1, commit = true) => {
    const view = playerRef.current
    const position = playerSeekTarget(pendingSeekRef.current ?? view.position, view.duration, direction, multiplier)
    pendingSeekRef.current = position
    updatePlayer({ position })
    setPlayerToolsActive(false)
    setPlayerPromptFocus('timeline')
    revealPlayerControls(true)
    showSeekFeedback(direction, multiplier)
    if (commit) flushPendingSeek()
  }

  const stopSeekHold = (action?: RemoteAction) => {
    const active = seekHoldActionRef.current
    if (action && action !== active) return
    if (seekHoldDelayRef.current) window.clearTimeout(seekHoldDelayRef.current)
    if (seekHoldIntervalRef.current) window.clearInterval(seekHoldIntervalRef.current)
    if (seekHoldReleaseRef.current) window.clearTimeout(seekHoldReleaseRef.current)
    seekHoldDelayRef.current = undefined
    seekHoldIntervalRef.current = undefined
    seekHoldReleaseRef.current = undefined
    seekHoldActionRef.current = undefined
    if (!active) return
    flushPendingSeek()
    if (seekFeedbackTimerRef.current) window.clearTimeout(seekFeedbackTimerRef.current)
    seekFeedbackTimerRef.current = window.setTimeout(() => setSeekFeedback(undefined), 900)
  }

  const releaseSeekHold = (action: RemoteAction) => {
    if (action !== seekHoldActionRef.current) return
    if (seekHoldReleaseRef.current) window.clearTimeout(seekHoldReleaseRef.current)
    // Tizen remotes can emit a key-up between repeat pulses. A short quiet period distinguishes
    // that cadence from a genuine release and prevents one decoder seek (and buffer cycle) per
    // pulse while preserving an immediate on-screen scrub position.
    seekHoldReleaseRef.current = window.setTimeout(() => {
      seekHoldReleaseRef.current = undefined
      stopSeekHold(action)
    }, SEEK_HOLD_RELEASE_GRACE_MS)
  }

  seekHoldKeyDownRef.current = (action, _repeated) => {
    if (action !== 'rewind' && action !== 'fastForward') {
      if (seekHoldActionRef.current) stopSeekHold()
      return false
    }
    if (screen !== 'player' || trailerOpen || stillWatching || Boolean(playerMenu)) {
      stopSeekHold()
      return false
    }
    if (seekHoldActionRef.current === action) {
      if (seekHoldReleaseRef.current) window.clearTimeout(seekHoldReleaseRef.current)
      seekHoldReleaseRef.current = undefined
      return true
    }
    stopSeekHold()
    seekHoldActionRef.current = action
    seekHoldStartedRef.current = tvNow()
    // Move the scrubber immediately at 1x so a short press never feels delayed. AVPlay itself is
    // left untouched until release; only the cheap player HUD updates throughout the hold.
    seekFromRemote(action === 'fastForward' ? 1 : -1, 1, false)
    seekHoldDelayRef.current = window.setTimeout(() => {
      const pulse = () => {
        const active = seekHoldActionRef.current
        if (!active) return
        const multiplier = seekHoldMultiplier(tvNow() - seekHoldStartedRef.current)
        // Scrub the UI continuously, but make one decoder seek on release. Repeated AVPlay seeks
        // cause a buffering cycle and saturate older Samsung TVs.
        seekFromRemote(active === 'fastForward' ? 1 : -1, multiplier, false)
      }
      pulse()
      seekHoldIntervalRef.current = window.setInterval(pulse, SEEK_HOLD_PULSE_MS)
    }, SEEK_HOLD_START_DELAY_MS)
    return true
  }
  seekHoldKeyUpRef.current = releaseSeekHold

  const activatePlayerControl = (index: number) => {
    setPlayerControlFocus(index)
    if (index === 0 && sourceChoices.length + (deviceSourceOptions?.choices.length ?? 0) + Number(deviceSourceChangeAvailable) === 0) {
      showNotice('No alternate sources are available for this playback.')
      return
    }
    setPlayerMenu(index === 0 ? 'source' : index === 1 ? 'audio' : index === 2 ? 'subtitles' : 'appearance')
    setPlayerMenuFocus(0)
  }

  const selectPlaybackSource = (choice: PlaybackSourceChoice) => {
    setPlayerMenu(null)
    if (choice.id === activeSourceId) {
      showNotice('That source is already playing.')
      return
    }
    const positionSeconds = playerRef.current.position
    setActiveSourceId(choice.id)
    currentSourceLabelRef.current = choice.label
    void startAvPlay({ ...choice.request, positionSeconds })
  }

  const requestLinkedDeviceSources = async () => {
    setDeviceSourceOptions(undefined)
    const sourceMedia = activeLoadRef.current?.media ?? selected
    const result = await receiverRef.current?.requestDeviceSourceChange(sourceMedia, playerRef.current.position) ?? 'open-client'
    if (typeof result !== 'string' && result.kind === 'resolved') {
      setSourceChoices(result.sources)
      setActiveSourceId(result.selectedId)
      await startAvPlay({ ...result.request, positionSeconds: playerRef.current.position })
    } else if (typeof result !== 'string') showNotice(result.message)
    else if (result === 'local') showNotice('Finding linked-device sources…')
    else if (result === 'notified') showNotice('A source-picker notification was sent to your linked phone.')
    else if (result === 'queued') showNotice('Open izumi on your linked phone to choose a source.')
    else if (result === 'worker-error') showNotice('Your private izumi Worker could not send the source request.')
    else if (result === 'no-source') showNotice('Linked-device sources are disabled in Cloudflare-only mode.')
    else showNotice('Open izumi on your linked device to choose a source.')
  }

  const selectLinkedDeviceSource = (choice: LinkedDeviceSourceChoice) => {
    const requestId = deviceSourceOptions?.requestId
    if (!requestId || !receiverRef.current?.selectDeviceSource(requestId, choice.id)) {
      showNotice('That linked-device source request expired. Refresh the list and try again.')
      return
    }
    setPlayerMenu(null)
    showNotice(`Opening ${choice.label}`)
  }

  const togglePlayback = () => {
    if (playbackEndedRef.current && activeLoadRef.current) {
      playbackEndedRef.current = false
      postPlayPresentedRef.current = false
      void startAvPlay({ ...activeLoadRef.current, positionSeconds: 0 })
      return
    }
    if (playerRef.current.state === 'playing' || playerRef.current.state === 'buffering') {
      avplayRef.current.pause()
      updatePlayer({ state: 'paused' })
    } else {
      avplayRef.current.play()
      updatePlayer({ state: 'playing' })
    }
    publishStatus(true)
  }

  const playerMenuLength = playerMenu === 'source'
    ? sourceChoices.length + (deviceSourceOptions?.choices.length ?? 0) + Number(deviceSourceChangeAvailable)
    : playerMenu === 'audio'
    ? audioTracks.length
    : playerMenu === 'subtitles' ? subtitleChoices.length : 3

  const activatePlayerMenuItem = () => {
    if (playerMenu === 'source') {
      const source = sourceChoices[playerMenuFocus]
      if (source) selectPlaybackSource(source)
      else {
        const deviceSource = deviceSourceOptions?.choices[playerMenuFocus - sourceChoices.length]
        if (deviceSource) selectLinkedDeviceSource(deviceSource)
        else if (deviceSourceChangeAvailable
          && playerMenuFocus === sourceChoices.length + (deviceSourceOptions?.choices.length ?? 0)) void requestLinkedDeviceSources()
      }
    } else if (playerMenu === 'audio') {
      const track = audioTracks[playerMenuFocus]
      if (track) selectAudioTrack(track)
    } else if (playerMenu === 'subtitles') {
      const choice = subtitleChoices[playerMenuFocus]
      if (choice) selectSubtitleChoice(choice)
    } else if (playerMenu === 'appearance') {
      changeSubtitleAppearance((['size', 'background', 'delay'] as const)[playerMenuFocus] ?? 'size')
    }
  }

  const browseItemsFor = (name: ScreenName): CompanionMedia[] => name === 'trending'
    ? Array.from(new Map([...trendingItems, ...seriesItems, ...movieItems].map((item) => [`${item.ref.provider}:${item.ref.type}:${item.ref.id}`, item])).values())
    : name === 'series' ? seriesItems : name === 'movies' ? movieItems : name === 'watch-history' ? watchHistoryItems : myListItems

  const playSeriesEpisode = (index: number) => {
    const counts = episodeCountsFor(selected)
    if (!counts.length) {
      showNotice('Episode information is not available yet. Refresh this title from izumi.')
      return
    }
    const activeSeason = Math.min(seriesSeason, counts.length - 1)
    const season = seasonNumberFor(selected, activeSeason, counts)
    const episode = index + 1
    const isResumeEpisode = season === (selected.season ?? 1) && episode === selected.episode
    playMedia({ ...selected, season, episode, progress: isResumeEpisode ? selected.progress : undefined })
  }

  const skipCurrentSegment = () => {
    const segment = visibleSkipSegment
    if (!segment) return
    handledSkipSegmentsRef.current = [...handledSkipSegmentsRef.current, skipSegmentKey(segment)]
    setVisibleSkipSegment(undefined)
    const position = segment.endTime + 0.2
    updatePlayer({ position })
    if (avplayRef.current.available) void avplayRef.current.seek(position).then(() => publishStatus(true))
    setPlayerPromptFocus(nextEpisodeVisible ? 'next' : 'transport')
  }

  const playNextEpisode = (autoplay = false) => {
    if (!upcomingEpisode) return
    setNextCountdown(undefined)
    void playMedia(upcomingEpisode.media, autoplay)
  }
  playNextEpisodeRef.current = () => playNextEpisode(true)

  playbackTimeRef.current = (position, duration) => {
    const segment = activeSkipSegment(skipSegments, position, handledSkipSegmentsRef.current)
    if (segment) {
      if (playbackSettings.autoSkipSegments) {
        handledSkipSegmentsRef.current = [...handledSkipSegmentsRef.current, skipSegmentKey(segment)]
        const destination = segment.endTime + 0.2
        updatePlayer({ position: destination })
        if (avplayRef.current.available) void avplayRef.current.seek(destination).then(() => publishStatus(true))
      } else {
        setVisibleSkipSegment(segment)
        if (!playerToolsActive) setPlayerPromptFocus('skip')
      }
    } else if (visibleSkipSegment) setVisibleSkipSegment(undefined)

    if (!upcomingEpisode) {
      if (playbackSettings.postPlayExperienceEnabled && !postPlayPresentedRef.current && shouldOfferNextEpisode(position, duration, skipSegments)) enterPostPlay(playbackMedia)
      return
    }
    if (nextEpisodeDismissed || !shouldOfferNextEpisode(position, duration, skipSegments)) return
    if (!nextEpisodeVisible) {
      setNextEpisodeVisible(true)
      setPlayerPromptFocus('next')
    }
    const nextKey = `${upcomingEpisode.media.ref.provider}:${upcomingEpisode.media.ref.id}:${upcomingEpisode.media.season}:${upcomingEpisode.media.episode}`
    if (prefetchedNextRef.current !== nextKey) {
      prefetchedNextRef.current = nextKey
      setNextSourceReady(false)
      void receiverRef.current?.prefetchPlay(upcomingEpisode.media).then(setNextSourceReady)
    }
    if (playbackSettings.autoplayNextEpisode && playbackSettings.stillWatchingEnabled && autoplayCountRef.current >= 3) {
      setNextCountdown(undefined)
      setStillWatching(true)
      setStillWatchingFocus(0)
    }
  }

  completedPlaybackRef.current = () => {
    playbackEndedRef.current = true
    updatePlayer({ position: playerRef.current.duration, state: 'paused' })
    publishStatus(true)
    if (upcomingEpisode) {
      finishActivePlayback()
      updatePlayer({ state: 'paused' })
      setNextEpisodeVisible(true)
      setPlayerPromptFocus('next')
      if (playbackSettings.autoplayNextEpisode && playbackSettings.stillWatchingEnabled && autoplayCountRef.current >= 3) {
        setStillWatching(true)
        setStillWatchingFocus(0)
      }
      setScreen('player')
      return
    }
    if (playbackSettings.postPlayExperienceEnabled) enterPostPlay(playbackMedia)
    else setScreen('player')
  }

  const answerStillWatching = (continueWatching: boolean) => {
    setStillWatching(false)
    if (!continueWatching) {
      autoplayCountRef.current = 0
      stopPlayback('home')
      return
    }
    autoplayCountRef.current = 0
    setNextEpisodeDismissed(false)
    setNextEpisodeVisible(true)
  }

  const activateSeriesOverviewAction = (action: SeriesOverviewAction) => {
    if (action === 'play') {
      const counts = episodeCountsFor(selected)
      if (!counts.length) {
        playMedia(selected)
        return
      }
      const activeSeason = Math.min(seriesSeason, counts.length - 1)
      const episodeCount = counts[activeSeason] ?? 1
      const seasonNumber = seasonNumberFor(selected, activeSeason, counts)
      const resumeIndex = seasonNumber === (selected.season ?? 1)
        ? Math.max(0, Math.min(episodeCount - 1, (selected.episode ?? 1) - 1))
        : 0
      playSeriesEpisode(resumeIndex)
      return
    }
    if (action === 'episodes') {
      changeFocus({ zone: 'episode', index: 0 })
      return
    }
    if (action === 'trailer') {
      openTrailer(selected)
      return
    }
    if (action === 'like' || action === 'dislike') {
      rateMedia(selected, action === 'like' ? 'up' : 'down')
      showNotice(action === 'like' ? 'Rating updated' : 'Recommendations adjusted')
      return
    }
    if (action === 'relations' && relatedTitlesFor(selected).length) changeFocus({ zone: 'relation', index: 0 })
  }

  const moveSeriesFocus = (action: RemoteAction) => {
    const focus = focusRef.current
    const counts = episodeCountsFor(selected)
    const overviewActions = seriesOverviewActionsFor(selected)
    if (focus.zone === 'series-action') {
      if (action === 'up') changeFocus({ zone: 'series-action', index: Math.max(0, focus.index - 1) })
      else if (action === 'down') {
        if (focus.index >= overviewActions.length - 1 && contributorsFor(selected).length) changeFocus({ zone: 'person', index: 0 })
        else changeFocus({ zone: 'series-action', index: Math.min(overviewActions.length - 1, focus.index + 1) })
      }
      return
    }
    if (focus.zone === 'person') {
      const contributors = contributorsFor(selected)
      if (action === 'left') return changeFocus({ zone: 'person', index: Math.max(0, focus.index - 1) })
      if (action === 'right') return changeFocus({ zone: 'person', index: Math.min(contributors.length - 1, focus.index + 1) })
      if (action === 'up') return changeFocus({ zone: 'series-action', index: overviewActions.length - 1 })
      return
    }
    if (!counts.length && focus.zone !== 'relation') return
    const activeSeason = Math.min(seriesSeason, counts.length - 1)
    const episodeCount = counts[activeSeason] ?? 1
    const seasonNumber = seasonNumberFor(selected, activeSeason, counts)
    const resumeIndex = seasonNumber === (selected.season ?? 1)
      ? Math.max(0, Math.min(episodeCount - 1, (selected.episode ?? 1) - 1))
      : 0
    if (focus.zone === 'series-season') {
      if (action === 'up' || action === 'down') {
        const index = action === 'up' ? Math.max(0, focus.index - 1) : Math.min(counts.length - 1, focus.index + 1)
        setSeriesSeason(index)
        return changeFocus({ zone: 'series-season', index })
      }
      if (action === 'right') return changeFocus({ zone: 'episode', index: resumeIndex })
      if (action === 'left') return changeFocus({ zone: 'series-action', index: Math.max(0, overviewActions.indexOf('episodes')) })
      return
    }
    if (focus.zone === 'episode') {
      if (action === 'left') return changeFocus({ zone: 'series-season', index: activeSeason })
      if (action === 'up') return changeFocus({ zone: 'episode', index: Math.max(0, focus.index - 1) })
      if (action === 'down') return changeFocus({ zone: 'episode', index: Math.min(episodeCount - 1, focus.index + 1) })
      return
    }
    if (focus.zone === 'relation') {
      const relations = relatedTitlesFor(selected)
      if (action === 'left') return changeFocus({ zone: 'series-action', index: Math.max(0, overviewActions.indexOf('relations')) })
      if (action === 'up') return changeFocus({ zone: 'relation', index: Math.max(0, focus.index - 1) })
      if (action === 'down') return changeFocus({ zone: 'relation', index: Math.min(relations.length - 1, focus.index + 1) })
    }
  }

  const moveBrowseFocus = (action: RemoteAction) => {
    const focus = focusRef.current
    const items = browseItemsFor(screen)
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(navItemCount() - 1, focus.index + 1) })
      else if (action === 'right' && items.length) {
        changeFocus({ zone: 'grid', index: 0 })
        setSelected(items[0])
      }
      return
    }
    if (focus.zone !== 'grid') return
    const columns = 6
    let index = focus.index
    if (action === 'left') {
      if (index % columns === 0) return changeFocus({ zone: 'nav', index: activeNav })
      index -= 1
    } else if (action === 'right') index = Math.min(items.length - 1, index + 1)
    else if (action === 'up') index = Math.max(0, index - columns)
    else if (action === 'down') index = Math.min(items.length - 1, index + columns)
    changeFocus({ zone: 'grid', index })
    if (items[index]) setSelected(items[index])
  }

  const applySearchKey = (index: number) => {
    const key = SEARCH_KEYS[index]?.value
    if (!key) return
    setSearchPerson(undefined)
    setSearchGenre(undefined)
    if (key === 'DELETE') setSearchQuery((value) => value.slice(0, -1))
    else if (key === 'SPACE') setSearchQuery((value) => `${value} `)
    else if (key === 'VOICE') changeFocus({ zone: 'search-input', index: 0 })
    else setSearchQuery((value) => `${value}${key}`.slice(0, 32))
  }

  const applySearchSuggestion = (index: number) => {
    const suggestion = searchSuggestions[index]
    if (!suggestion) return
    setSearchPerson(undefined)
    searchGenreRef.current = suggestion
    setSearchGenre(suggestion)
    setSearchQuery(suggestion)
  }

  const moveSearchFocus = (action: RemoteAction) => {
    const focus = focusRef.current
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(navItemCount() - 1, focus.index + 1) })
      else if (action === 'right') changeSearchKeyFocus(0)
      return
    }
    if (focus.zone === 'keyboard') {
      const currentKey = SEARCH_KEYS[focus.index]
      if (!currentKey) return changeSearchKeyFocus(0)
      if (action === 'left') {
        const next = adjacentSearchKey(focus.index, 'left')
        if (next === undefined && currentKey.value === 'a') return changeSearchKeyFocus(SEARCH_VOICE_KEY_INDEX)
        return next === undefined
          ? changeFocus({ zone: 'nav', index: activeNav })
          : changeSearchKeyFocus(next)
      }
      if (action === 'right') {
        const next = adjacentSearchKey(focus.index, 'right')
        if (next !== undefined) return changeSearchKeyFocus(next)
        if (searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
        return
      }
      if (action === 'up') {
        const next = adjacentSearchKey(focus.index, 'up', searchKeyboardColumnRef.current)
        if (next !== undefined) changeSearchKeyFocus(next, true)
        return
      }
      if (action === 'down') {
        const next = adjacentSearchKey(focus.index, 'down', searchKeyboardColumnRef.current)
        if (next !== undefined) return changeSearchKeyFocus(next, true)
        if (searchSuggestions.length) return changeFocus({ zone: 'suggestion', index: 0 })
        if (searchResults.length) return changeFocus({ zone: 'grid', index: Math.min(searchResults.length - 1, Math.floor(currentKey.column / 2)) })
      }
      return
    }
    if (focus.zone === 'suggestion') {
      if (action === 'left') return changeFocus({ zone: 'nav', index: activeNav })
      if (action === 'right' && searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
      if (action === 'up') {
        if (focus.index === 0) return changeSearchKeyFocus(nearestSearchKey(SEARCH_KEY_LAST_ROW, 2.5))
        return changeFocus({ zone: 'suggestion', index: focus.index - 1 })
      }
      if (action === 'down') {
        if (focus.index < searchSuggestions.length - 1) return changeFocus({ zone: 'suggestion', index: focus.index + 1 })
        if (searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
      }
      return
    }
    if (focus.zone === 'search-input') {
      if (action === 'down' && searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
      if (action === 'right' && searchResults.length) return changeFocus({ zone: 'grid', index: 0 })
      if (action === 'left' || action === 'back') return changeSearchKeyFocus(SEARCH_VOICE_KEY_INDEX)
      return
    }
    if (focus.zone === 'grid') {
      const columns = 4
      let index = focus.index
      if (action === 'left') {
        if (index % columns === 0) return changeSearchKeyFocus(
          nearestSearchKey(Math.min(SEARCH_KEY_LAST_ROW, Math.floor(index / columns) + 1), 5.5),
        )
        index -= 1
      } else if (action === 'right') index = Math.min(searchResults.length - 1, index + 1)
      else if (action === 'up') {
        if (index < columns) return
        index -= columns
      } else if (action === 'down') index = Math.min(searchResults.length - 1, index + columns)
      changeFocus({ zone: 'grid', index })
      if (searchResults[index]) setSelected(searchResults[index])
    }
  }

  const openIndependentSetup = () => {
    setIndependentSetupError('')
    setIndependentSetupPhase(independentPlaybackReady ? 'ready' : 'intro')
    setScreen('independent-setup')
    setActiveNav(navIndexFor('settings'))
    changeFocus({ zone: 'setting', index: independentPlaybackReady ? 0 : 1 })
  }

  const closeIndependentSetup = () => {
    setScreen('settings')
    setActiveNav(navIndexFor('settings'))
    changeFocus({ zone: 'setting', index: 7 })
  }

  const startIndependentSetup = () => {
    setIndependentSetupError('')
    if (receiverRef.current?.requestIndependentSetup() || showPreviewTools) {
      setIndependentSetupPhase('waiting')
      changeFocus({ zone: 'setting', index: 0 })
      return
    }
    setIndependentSetupError('Open izumi on the device currently linked to this TV, then try again.')
    setIndependentSetupPhase('error')
    changeFocus({ zone: 'setting', index: 1 })
  }

  const openStandaloneLink = () => {
    setScreen('standalone-link')
    changeFocus({ zone: 'setting', index: 0 })
  }

  const closeStandaloneLink = () => {
    setScreen('ready')
    changeFocus({ zone: 'setting', index: 0 })
  }

  const approveStandaloneLink = () => {
    if (tvLinkReceiverRef.current?.approveSession()) changeFocus({ zone: 'setting', index: 0 })
  }

  const rejectStandaloneLink = () => {
    tvLinkReceiverRef.current?.rejectSession()
    changeFocus({ zone: 'setting', index: 0 })
  }

  const runSettingsAction = (index: number) => {
    if (!settingsConfirmation) {
      if (index < 7) {
        const key = (['homeCarouselLayout', 'videoPreviewsEnabled', 'postPlayExperienceEnabled', 'autoplayNextEpisode', 'autoSkipSegments', 'stillWatchingEnabled', 'preferBingeSource'] as const)[index]
        setPlaybackSettings((current) => ({ ...current, [key]: !current[key] }))
        showNotice(`${index === 0 ? 'Home layout' : index === 1 ? 'Video previews' : index === 2 ? 'Post-play mini-player' : index === 3 ? 'Autoplay' : index === 4 ? 'Automatic skipping' : index === 5 ? 'Still watching check' : 'Source continuity'} updated`)
        return
      }
      if (index === 7) return openIndependentSetup()
      setSettingsConfirmation(index === 8 ? 'unpair' : 'reset')
      changeFocus({ zone: 'setting', index: 0 })
      return
    }
    if (index === 0) {
      setSettingsConfirmation(null)
      changeFocus({ zone: 'setting', index: settingsConfirmation === 'unpair' ? 8 : 9 })
      return
    }
    if (settingsConfirmation === 'unpair') receiverRef.current?.unpair()
    else {
      receiverRef.current?.resetClient()
      setSearchQuery('')
      const defaults = sourceSubtitlePreferences()
      subtitlePreferencesRef.current = defaults
      setSubtitlePreferences(defaults)
      setPlaybackSettings(readPlaybackExperienceSettings())
    }
    setSnapshot(emptySnapshot)
    setSelected(fallbackMedia)
    setSettingsConfirmation(null)
    setIndependentPlaybackReady(false)
    setScreen('ready')
    changeFocus({ zone: 'setting', index: 0 })
  }

  const moveSettingsFocus = (action: RemoteAction) => {
    const focus = focusRef.current
    if (settingsConfirmation) {
      if (action === 'left') changeFocus({ zone: 'setting', index: 0 })
      else if (action === 'right') changeFocus({ zone: 'setting', index: 1 })
      else if (action === 'back') runSettingsAction(0)
      return
    }
    if (focus.zone === 'nav') {
      if (action === 'up') changeFocus({ zone: 'nav', index: Math.max(-1, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'nav', index: Math.min(navItemCount() - 1, focus.index + 1) })
      else if (action === 'right') changeFocus({ zone: 'setting', index: 0 })
    } else if (focus.zone === 'setting') {
      if (action === 'left') changeFocus({ zone: 'nav', index: activeNav })
      else if (action === 'up') changeFocus({ zone: 'setting', index: Math.max(0, focus.index - 1) })
      else if (action === 'down') changeFocus({ zone: 'setting', index: Math.min(9, focus.index + 1) })
    }
  }

  const handleRemote = (action: RemoteAction) => {
    if (profilesOpenRef.current) { window.dispatchEvent(new CustomEvent(PROFILE_REMOTE, { detail: action })); return }
    if (screen === 'discover') { window.dispatchEvent(new CustomEvent(DISCOVERY_REMOTE, { detail: action })); return }
    markRemoteInput(action)
    const focus = focusRef.current
    if (exitConfirmation) {
      if (action === 'left' || action === 'up') setExitFocus(0)
      else if (action === 'right' || action === 'down') setExitFocus(1)
      else if (action === 'select') exitFocus === 0 ? setExitConfirmation(false) : exitApplication()
      else if (action === 'back') setExitConfirmation(false)
      return
    }
    if (trailerOpen) {
      if (action === 'back' || action === 'stop') closeTrailer()
      else {
        const trailerAction: TrailerControlAction | undefined = action === 'select' || action === 'playPause'
          ? 'toggle'
          : action === 'play'
            ? 'play'
            : action === 'pause'
              ? 'pause'
              : action === 'left' || action === 'rewind'
                ? 'seek-back'
                : action === 'right' || action === 'fastForward'
                  ? 'seek-forward'
                  : undefined
        if (trailerAction) window.dispatchEvent(new CustomEvent<TrailerControlAction>(TRAILER_CONTROL_EVENT, { detail: trailerAction }))
      }
      return
    }
    if (cinematicScreen) {
      if (catalogMenuOpen) {
        if (action === 'up' || action === 'down') {
          const offset = action === 'up' ? -1 : 1
          const index = Math.max(0, Math.min(catalogOptions.length - 1, focus.index + offset))
          setCatalogMenuFocus(index)
          changeFocus({ zone: 'catalog', index })
        } else if (action === 'select') selectCatalogOption(focus.index)
        else if (action === 'left' || action === 'back') closeCatalogMenu()
        else if (action === 'right') {
          setCatalogMenuOpen(false)
          changeFocus(lastHomeContentFocusRef.current)
        }
        return
      }
      if (['up', 'down', 'left', 'right'].includes(action)) moveHomeFocus(action)
      else if (action === 'select') activateCurrentFocus()
      else if (action === 'back') requestExit()
      return
    }
    if (screen === 'search') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveSearchFocus(action)
      else if (action === 'select') {
        if (focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'keyboard') applySearchKey(focus.index)
        else if (focus.zone === 'suggestion') applySearchSuggestion(focus.index)
        else if (focus.zone === 'search-input') document.querySelector<HTMLInputElement>('[data-focus-id="search-input-0"]')?.focus()
        else if (focus.zone === 'grid' && searchResults[focus.index]) selectCatalogMedia(searchResults[focus.index])
      } else if (action === 'back') {
        if (!restorePreviousNavigation()) selectNav(0)
      }
      return
    }
    if (screen === 'series') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveSeriesFocus(action)
      else if (action === 'select') {
        if (focus.zone === 'series-action') activateSeriesOverviewAction(seriesOverviewActionsFor(selected)[focus.index] ?? 'play')
        else if (focus.zone === 'series-season') changeFocus({ zone: 'episode', index: 0 })
        else if (focus.zone === 'episode') playSeriesEpisode(focus.index)
        else if (focus.zone === 'relation') {
          const relation = relatedTitlesFor(selected)[focus.index]
          if (relation) selectRelatedMedia(relation.media)
        }
        else if (focus.zone === 'person') {
          const person = contributorsFor(selected)[focus.index]
          if (person) openPersonSearch(person)
        }
      } else if (action === 'back') {
        const actions = seriesOverviewActionsFor(selected)
        if (focus.zone === 'series-season' || focus.zone === 'episode') changeFocus({ zone: 'series-action', index: Math.max(0, actions.indexOf('episodes')) })
        else if (focus.zone === 'relation') changeFocus({ zone: 'series-action', index: Math.max(0, actions.indexOf('relations')) })
        else if (focus.zone === 'person') changeFocus({ zone: 'series-action', index: actions.length - 1 })
        else {
          if (!restorePreviousNavigation()) restoreHomeNavigation()
        }
      }
      return
    }
    if (screen === 'my-list' || screen === 'watch-history') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveBrowseFocus(action)
      else if (action === 'select') {
        if (focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'grid') {
          const media = browseItemsFor(screen)[focus.index]
          if (media) selectCatalogMedia(media)
        }
      } else if (action === 'back') selectNav(0)
      return
    }
    if (screen === 'settings') {
      if (['up', 'down', 'left', 'right'].includes(action)) moveSettingsFocus(action)
      else if (action === 'select') {
        if (!settingsConfirmation && focus.zone === 'nav') selectNav(focus.index)
        else if (focus.zone === 'setting') runSettingsAction(focus.index)
      } else if (action === 'back') settingsConfirmation ? runSettingsAction(0) : selectNav(0)
      return
    }
    if (screen === 'independent-setup') {
      const canStart = independentSetupPhase === 'intro' || independentSetupPhase === 'error'
      if (canStart && (action === 'left' || action === 'up')) changeFocus({ zone: 'setting', index: 0 })
      else if (canStart && (action === 'right' || action === 'down')) changeFocus({ zone: 'setting', index: 1 })
      else if (action === 'select') focus.index === 1 && canStart ? startIndependentSetup() : closeIndependentSetup()
      else if (action === 'back') closeIndependentSetup()
      return
    }
    if (screen === 'standalone-link') {
      if (tvLinkInfo.phase === 'confirming') {
        if (action === 'left' || action === 'up') changeFocus({ zone: 'setting', index: 0 })
        else if (action === 'right' || action === 'down') changeFocus({ zone: 'setting', index: 1 })
        else if (action === 'select') focus.index === 1 ? approveStandaloneLink() : rejectStandaloneLink()
        else if (action === 'back') rejectStandaloneLink()
      } else if (action === 'select' || action === 'back') closeStandaloneLink()
      return
    }
    if (screen === 'details') {
      const actions = detailActionsFor(selected)
      const contributors = contributorsFor(selected)
      const relations = relatedTitlesFor(selected)
      if (focus.zone === 'person') {
        if (action === 'left') changeFocus({ zone: 'person', index: Math.max(0, focus.index - 1) })
        else if (action === 'right') changeFocus({ zone: 'person', index: Math.min(contributors.length - 1, focus.index + 1) })
        else if (action === 'up' || action === 'back') changeFocus({ zone: 'detail', index: 0 })
        else if (action === 'down' && relations.length) changeFocus({ zone: 'relation', index: 0 })
        else if (action === 'select' && contributors[focus.index]) openPersonSearch(contributors[focus.index])
        return
      }
      if (focus.zone === 'relation') {
        if (action === 'up') changeFocus(focus.index > 0
          ? { zone: 'relation', index: focus.index - 1 }
          : contributors.length ? { zone: 'person', index: 0 } : { zone: 'detail', index: 0 })
        else if (action === 'down') changeFocus({ zone: 'relation', index: Math.min(relations.length - 1, focus.index + 1) })
        else if (action === 'left') changeFocus({ zone: 'relation', index: Math.max(0, focus.index - 1) })
        else if (action === 'right') changeFocus({ zone: 'relation', index: Math.min(relations.length - 1, focus.index + 1) })
        else if (action === 'select' && relations[focus.index]) selectRelatedMedia(relations[focus.index].media)
        else if (action === 'back') changeFocus({ zone: 'detail', index: 0 })
        return
      }
      if (action === 'left') changeFocus({ zone: 'detail', index: Math.max(0, focus.index - 1) })
      else if (action === 'right') changeFocus({ zone: 'detail', index: Math.min(actions.length - 1, focus.index + 1) })
      else if (action === 'down' && (contributors.length || relations.length)) changeFocus(contributors.length ? { zone: 'person', index: 0 } : { zone: 'relation', index: 0 })
      else if (action === 'select' && focus.zone === 'detail') {
        const selectedAction = actions[focus.index] ?? 'play'
        if (selectedAction === 'play') playMedia(selected)
        else if (selectedAction === 'trailer') openTrailer(selected)
        else if (selectedAction === 'like' || selectedAction === 'dislike') {
          rateMedia(selected, selectedAction === 'like' ? 'up' : 'down')
          showNotice(selectedAction === 'like' ? 'Rating updated' : 'Recommendations adjusted')
        }
        else closeDetails()
      }
      else if (action === 'back') closeDetails()
      return
    }
    if (screen === 'player') {
      if (stillWatching) {
        if (action === 'left' || action === 'up') setStillWatchingFocus(0)
        else if (action === 'right' || action === 'down') setStillWatchingFocus(1)
        else if (action === 'select') answerStillWatching(stillWatchingFocus === 0)
        else if (action === 'back' || action === 'stop') answerStillWatching(false)
        return
      }
      if (playerMenu) {
        revealPlayerControls(true)
        if (action === 'up') setPlayerMenuFocus((index) => Math.max(0, index - 1))
        else if (action === 'down') setPlayerMenuFocus((index) => Math.min(Math.max(0, playerMenuLength - 1), index + 1))
        else if (action === 'select') activatePlayerMenuItem()
        else if (action === 'left' || action === 'back') setPlayerMenu(null)
        return
      }
      if (action === 'back' && playerControlsVisible) {
        hidePlayerControls()
        return
      }
      revealPlayerControls(playerRef.current.state !== 'playing' || playerToolsActive || playerPromptFocus === 'timeline')
      if (action === 'select' && playerPromptFocus === 'skip' && visibleSkipSegment) {
        skipCurrentSegment()
        return
      }
      if (action === 'select' && playerPromptFocus === 'next' && nextEpisodeVisible && upcomingEpisode) {
        playNextEpisode()
        return
      }
      if ((action === 'back' || action === 'stop') && playerPromptFocus === 'next' && nextEpisodeVisible) {
        setNextEpisodeDismissed(true)
        setNextEpisodeVisible(false)
        setNextCountdown(undefined)
        setPlayerPromptFocus('transport')
        return
      }
      if (action === 'down') {
        if (playerToolsActive) return
        if (playerPromptFocus === 'transport') setPlayerPromptFocus('timeline')
        else if (playerPromptFocus === 'timeline') setPlayerToolsActive(true)
        else setPlayerPromptFocus('transport')
      }
      else if (action === 'up') {
        if (playerToolsActive) {
          setPlayerToolsActive(false)
          setPlayerPromptFocus('timeline')
        } else if (playerPromptFocus === 'timeline') {
          setPlayerPromptFocus('transport')
        } else if (playerPromptFocus === 'transport') {
          if (nextEpisodeVisible) setPlayerPromptFocus('next')
          else if (visibleSkipSegment) setPlayerPromptFocus('skip')
        }
      }
      else if (action === 'left') playerToolsActive
        ? setPlayerControlFocus((index) => Math.max(0, index - 1))
        : playerPromptFocus === 'next' && visibleSkipSegment
          ? setPlayerPromptFocus('skip')
          : seekFromRemote(-1)
      else if (action === 'right') playerToolsActive
        ? setPlayerControlFocus((index) => Math.min(3, index + 1))
        : playerPromptFocus === 'skip' && nextEpisodeVisible
          ? setPlayerPromptFocus('next')
          : seekFromRemote(1)
      else if (action === 'rewind') seekFromRemote(-1)
      else if (action === 'fastForward') seekFromRemote(1)
      else if (action === 'select') {
        if (playerToolsActive) activatePlayerControl(playerControlFocus)
        else if (playerPromptFocus === 'transport') togglePlayback()
      }
      else if (action === 'pause' || action === 'playPause' && playerRef.current.state === 'playing') {
        avplayRef.current.pause()
        updatePlayer({ state: 'paused' })
        publishStatus(true)
      } else if (action === 'play' || action === 'playPause') {
        avplayRef.current.play()
        updatePlayer({ state: 'playing' })
        publishStatus(true)
      } else if (action === 'back' || action === 'stop') stopPlayback('home')
      return
    }
    if (screen === 'postplay') {
      const miniAvailable = playbackSettings.postPlayExperienceEnabled
      if (action === 'back' || action === 'stop') return returnToPostPlayPlayer()
      if (postPlayStage === 'rating') {
        if (action === 'left') setPostPlayFocus((index) => index === 2 ? 1 : miniAvailable ? 0 : 1)
        else if (action === 'right') setPostPlayFocus((index) => index === 0 ? 1 : Math.min(2, index + 1))
        else if (action === 'up' || action === 'down') setPostPlayFocus((index) => index === 0 ? 0 : index)
        else if (action === 'select') {
          if (postPlayFocus === 0 && miniAvailable) returnToPostPlayPlayer()
          else answerPostPlayRating(postPlayFocus === 2 ? 'down' : 'up')
        }
        return
      }
      const firstRecommendation = 3
      const lastRecommendation = postPlayItems.length ? postPlayItems.length + 2 : 2
      if (action === 'left') {
        setPostPlayFocus((index) => {
          if (index === 1) return miniAvailable ? 0 : 1
          if (index === 2) return 1
          return index > firstRecommendation ? index - 1 : index
        })
      } else if (action === 'right') {
        setPostPlayFocus((index) => index === 0 ? 1 : index === 1 ? 2 : Math.min(lastRecommendation, index + 1))
      } else if (action === 'up') {
        setPostPlayFocus((index) => index >= firstRecommendation + 3 ? index - 3 : index >= firstRecommendation ? 1 : index)
      } else if (action === 'down') {
        setPostPlayFocus((index) => index < firstRecommendation
          ? postPlayItems.length ? firstRecommendation : index
          : Math.min(lastRecommendation, index + 3))
      } else if (action === 'select') {
        if (postPlayFocus === 0 && miniAvailable) returnToPostPlayPlayer()
        else if (postPlayFocus === 1) void playMedia(postPlayMedia)
        else if (postPlayFocus === 2) {
          finishActivePlayback()
          clearNavigationHistory()
          restoreHomeNavigation()
        } else {
          const media = postPlayItems[postPlayFocus - firstRecommendation]
          if (media) {
            finishActivePlayback()
            selectCatalogMedia(media)
          }
        }
      }
      return
    }
    if (screen === 'loading') {
      if (action === 'back' || action === 'stop') stopPlayback('home')
      return
    }
    if (screen === 'error') {
      if (action === 'back') stopPlayback(paired ? 'home' : 'ready')
      else if (action === 'select') retryPlayback()
      return
    }
    if (screen === 'ready') {
      if (action === 'back') requestExit()
      else if (action === 'select') openStandaloneLink()
      return
    }
    if (action === 'back') requestExit()
  }

  remoteHandlerRef.current = handleRemote

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return
      const action = remoteAction(event)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      const holdConsumed = seekHoldKeyDownRef.current?.(action, event.repeat) ?? false
      if (!holdConsumed) remoteHandlerRef.current?.(action)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const action = remoteAction(event)
      if (action) seekHoldKeyUpRef.current?.(action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      stopSeekHold()
    }
  }, [])

  const previewScreen = (next: ScreenName) => {
    if (simulationTimerRef.current) window.clearTimeout(simulationTimerRef.current)
    clearNavigationHistory()
    setCatalogMenuOpen(false)
    closeTrailer()
    if (next === 'home') {
      setActiveNav(0)
      heroIndexRef.current = 0
      setHeroIndex(0)
      setSelected(snapshot.hero ?? snapshot.rows[0]?.items[0] ?? fallbackMedia)
      lastHomeContentFocusRef.current = { zone: 'hero', index: 0 }
      changeFocus({ zone: 'hero', index: 0 })
    }
    if (next === 'search') {
      setActiveNav(1)
      changeSearchKeyFocus(0)
    }
    if (next === 'trending') {
      if (isMergedCatalog(snapshot)) enterCinematicDestination('trending')
      else requestCatalogOption(mergedCatalogOption(snapshot), 'trending')
      return
    }
    if (next === 'series-home' || next === 'movies') {
      enterCinematicDestination(next)
      return
    }
    if (['series', 'my-list', 'watch-history'].includes(next)) {
      const navIndex = next === 'series' ? navIndexFor('series-home') : navIndexFor(next)
      const items = browseItemsFor(next)
      setActiveNav(navIndex)
      setSelected(items[0] ?? fallbackMedia)
      if (next === 'series') {
        setSeriesSeason(0)
        changeFocus(initialSeriesFocus())
      } else changeFocus({ zone: 'grid', index: 0 })
    }
    if (next === 'settings') {
      setActiveNav(navIndexFor('settings'))
      setSettingsConfirmation(null)
      changeFocus({ zone: 'setting', index: 0 })
    }
    if (next === 'ready' || next === 'standalone-link') changeFocus({ zone: 'setting', index: 0 })
    if (next === 'loading') setLoadingProgress(34)
    if (next === 'player') {
      setPlayerControlFocus(0)
      setPlayerToolsActive(false)
      setPlayerMenu(null)
      setPlayerControlsVisible(true)
      if (activeSubtitleRef.current !== 'off') setSubtitleText('Even the smallest journey can change the world.')
      updatePlayer({
        title: selected.title,
        state: 'playing',
        duration: player.duration || 1_422,
        bufferedPosition: Math.max(player.bufferedPosition, player.position + 30),
      })
    }
    if (next === 'postplay') {
      setPostPlayMedia(selected)
      setPostPlayFocus(0)
    }
    setScreen(next)
  }

  return (
    <div class={`app-shell screen-${screen}${safeArea ? ' show-safe-area' : ''}`}>
      {profilesOpen && <ProfileScreen onChoose={() => {
        setProfilesOpen(false)
        clearNavigationHistory()
        setRemoteSearchResults([])
        setSearchQuery('')
        setSearchPerson(undefined)
        setSearchGenre(undefined)
        if (catalogRequestRef.current) window.clearTimeout(catalogRequestRef.current.timer)
        catalogRequestRef.current = undefined
        receiverRef.current?.refreshForProfile()
      }} onRefresh={() => receiverRef.current?.requestRefresh()}/>}
      {cinematicScreen && (
        <HomeScreen
          snapshot={renderedCinematicSnapshot}
          hero={selected}
          heroIndex={heroIndex}
          heroCount={homeHeroRail.length}
          page={screen === 'trending' ? 'browse' : screen === 'series-home' ? 'series' : screen === 'movies' ? 'movies' : 'home'}
          carouselLayout={playbackSettings.homeCarouselLayout}
          focus={focus}
          returnFocus={lastHomeContentFocusRef.current}
          activeNav={activeNav}
          catalogOpen={catalogMenuOpen}
          catalogFocus={catalogMenuFocus}
          notice={notice}
          trailerPreview={homeTrailerPreview}
          prefetchMedia={homePrefetchMedia}
          onFocus={changeFocus}
          onNav={selectNav}
          onPlay={playMedia}
          onOpenSeries={selectCatalogMedia}
          onDetails={openDetails}
          onCatalogFocus={(index) => {
            setCatalogMenuFocus(index)
            changeFocus({ zone: 'catalog', index })
          }}
          onCatalogSelect={selectCatalogOption}
          onCatalogClose={closeCatalogMenu}
        />
      )}
      {screen === 'details' && (
        <DetailScreen
          media={selected}
          focus={focus}
          onFocus={(index) => changeFocus({ zone: 'detail', index })}
          onPlay={playMedia}
          onTrailer={openTrailer}
          onClose={closeDetails}
          trailerOpen={trailerOpen}
          trailerSource={trailerSource?.url}
          trailerError={trailerError}
          onPersonFocus={(index) => changeFocus({ zone: 'person', index })}
          onPersonSelect={openPersonSearch}
          onRelationFocus={(index) => changeFocus({ zone: 'relation', index })}
          onRelationSelect={selectRelatedMedia}
          rating={ratingFor(selected)}
          onRate={(value) => rateMedia(selected, value)}
        />
      )}
      {screen === 'search' && (
        <SearchScreen
          query={searchQuery}
          suggestions={searchSuggestions}
          results={searchResults}
          loading={searchPending}
          error={searchError}
          focus={focus}
          activeNav={activeNav}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onKey={applySearchKey}
          onKeyFocus={changeSearchKeyFocus}
          onSuggestion={applySearchSuggestion}
          onSuggestionFocus={(index) => changeFocus({ zone: 'suggestion', index })}
          onResultFocus={(index) => {
            changeFocus({ zone: 'grid', index })
            if (searchResults[index]) setSelected(searchResults[index])
          }}
          onResultSelect={selectCatalogMedia}
          onQueryChange={(value) => {
            setSearchPerson(undefined)
            setSearchGenre(undefined)
            setSearchQuery(value)
          }}
          onQueryFocus={() => changeFocus({ zone: 'search-input', index: 0 })}
          onQueryDone={() => changeSearchKeyFocus(SEARCH_VOICE_KEY_INDEX)}
          resultTitle={searchPerson
            ? `Results for ${searchPerson.credit === 'cast' ? 'actor ' : ''}${searchPerson.name}`
            : searchGenre ? `${searchGenre} titles` : undefined}
        />
      )}
      {screen === 'series' && (
        <SeriesScreen
          selected={selected}
          hideSpoilers={snapshot.spoilersHidden === true}
          season={seriesSeason}
          focus={focus}
          onSeriesActionFocus={(index) => changeFocus({ zone: 'series-action', index })}
          onSeriesAction={activateSeriesOverviewAction}
          onSeasonFocus={(index) => {
            setSeriesSeason(index)
            changeFocus({ zone: 'series-season', index })
          }}
          onSeasonSelect={(index) => {
            setSeriesSeason(index)
            changeFocus({ zone: 'episode', index: 0 })
          }}
          onEpisodeFocus={(index) => changeFocus({ zone: 'episode', index })}
          onEpisodePlay={playSeriesEpisode}
          onRelationFocus={(index) => changeFocus({ zone: 'relation', index })}
          onRelationSelect={selectRelatedMedia}
          onPersonFocus={(index) => changeFocus({ zone: 'person', index })}
          onPersonSelect={openPersonSearch}
          rating={ratingFor(selected)}
          trailerOpen={trailerOpen}
          trailerSource={trailerSource?.url}
          trailerError={trailerError}
        />
      )}
      {(['my-list', 'watch-history'] as const).map((name) => screen === name && (
        <CatalogScreen
          mode={name}
          title={name === 'my-list' ? 'My List' : 'Watch History'}
          description={name === 'my-list'
            ? 'Saved and in-progress titles from your izumi library.'
            : 'Titles you watched recently, ordered by playback activity.'}
          items={browseItemsFor(name)}
          selected={selected}
          focus={focus}
          activeNav={activeNav}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onFocus={(index) => {
            changeFocus({ zone: 'grid', index })
            const media = browseItemsFor(name)[index]
            if (media) setSelected(media)
          }}
          onSelect={selectCatalogMedia}
          key={name}
        />
      ))}
      {screen === 'discover' && <DiscoveryScreen key={tvProfileId()} snapshot={snapshot} receiver={receiverRef.current} onDetails={selectCatalogMedia} onBack={() => selectNav(navIndexFor('my-list'))} />}
      {screen === 'settings' && (
        <SettingsScreen
          focus={focus}
          activeNav={activeNav}
          paired={paired}
          connected={connected}
          independentReady={independentPlaybackReady}
          deviceId={pairing?.deviceId}
          confirmation={settingsConfirmation}
          playbackSettings={playbackSettings}
          onNav={selectNav}
          onNavFocus={(index) => changeFocus({ zone: 'nav', index })}
          onFocus={(index) => changeFocus({ zone: 'setting', index })}
          onAction={runSettingsAction}
        />
      )}
      {screen === 'independent-setup' && (
        <IndependentSetupScreen
          phase={independentSetupPhase}
          connected={connected}
          focusIndex={focus.zone === 'setting' ? focus.index : 0}
          error={independentSetupError}
          onFocus={(index) => changeFocus({ zone: 'setting', index })}
          onBack={closeIndependentSetup}
          onStart={startIndependentSetup}
        />
      )}
      {screen === 'ready' && (
        <ReadyScreen
          connected={connected}
          qrCode={qrCode}
          pairingCode={pairingDisplayCode}
          expiresAt={pairing?.expiresAt}
          posters={Array.from(new Set(snapshot.rows.flatMap((row) => row.items.map((item) => item.poster).filter(Boolean) as string[]))).slice(0, 12)}
          independentFocused={focus.zone === 'setting'}
          onIndependentFocus={() => changeFocus({ zone: 'setting', index: 0 })}
          onIndependent={openStandaloneLink}
        />
      )}
      {screen === 'standalone-link' && (
        <StandaloneLinkScreen
          connected={connected}
          qrCode={standaloneQrCode}
          pairingCode={tvLinkDisplayCode}
          expiresAt={tvLinkInfo.expiresAt}
          phase={tvLinkInfo.phase}
          statusMessage={tvLinkInfo.message}
          confirmation={tvLinkInfo.confirmation}
          confirmationFocus={focus.index}
          posters={Array.from(new Set(snapshot.rows.flatMap((row) => row.items.map((item) => item.poster).filter(Boolean) as string[]))).slice(0, 12)}
          backFocused={focus.zone === 'setting'}
          onBackFocus={() => changeFocus({ zone: 'setting', index: 0 })}
          onConfirmationFocus={(index) => changeFocus({ zone: 'setting', index })}
          onBack={closeStandaloneLink}
          onApprove={approveStandaloneLink}
          onReject={rejectStandaloneLink}
        />
      )}
      {screen === 'loading' && (
        <LoadingScreen
          title={player.title}
          progress={loadingProgress}
          contentRating={activeLoadRef.current?.contentRating ?? (selected.title === player.title ? selected.contentRating : undefined)}
        />
      )}
      {screen === 'player' && (
        <PlayerScreen
          {...player}
          controlFocus={playerControlFocus}
          controlsFocused={playerToolsActive}
          menu={playerMenu}
          menuFocus={playerMenuFocus}
          sourceChoices={sourceChoices}
          deviceSourceOptions={deviceSourceOptions}
          activeSourceId={activeSourceId}
          deviceSourceChangeAvailable={deviceSourceChangeAvailable}
          audioTracks={audioTracks}
          subtitleChoices={subtitleChoices}
          activeAudio={activeAudio}
          activeSubtitle={activeSubtitle}
          subtitleText={subtitleText}
          subtitlePreferences={subtitlePreferences}
          previewBackdrop={showPreviewTools ? selected.backdrop || selected.poster : undefined}
          controlsVisible={playerControlsVisible}
          bufferingProgress={loadingProgress}
          seekFeedback={seekFeedback}
          transportFocused={!playerToolsActive && playerPromptFocus === 'transport'}
          timelineFocused={!playerToolsActive && playerPromptFocus === 'timeline'}
          skipSegments={skipSegments}
          skipSegment={visibleSkipSegment}
          skipFocused={playerPromptFocus === 'skip'}
          nextEpisode={upcomingEpisode?.media}
          nextEpisodeVisible={nextEpisodeVisible && !nextEpisodeDismissed}
          nextFocused={playerPromptFocus === 'next'}
          nextCountdown={nextCountdown}
          nextSourceReady={nextSourceReady}
          stillWatching={stillWatching}
          stillWatchingFocus={stillWatchingFocus}
          onControlFocus={(index) => {
            setPlayerControlFocus(index)
            setPlayerToolsActive(true)
            revealPlayerControls(true)
          }}
          onTransportFocus={() => {
            setPlayerToolsActive(false)
            setPlayerPromptFocus('transport')
            revealPlayerControls(true)
          }}
          onTimelineFocus={() => {
            setPlayerToolsActive(false)
            setPlayerPromptFocus('timeline')
            revealPlayerControls(true)
          }}
          onToggle={togglePlayback}
          onControl={activatePlayerControl}
          onMenuFocus={setPlayerMenuFocus}
          onSource={selectPlaybackSource}
          onDeviceSource={selectLinkedDeviceSource}
          onDeviceSources={() => void requestLinkedDeviceSources()}
          onAudio={selectAudioTrack}
          onSubtitle={selectSubtitleChoice}
          onAppearance={changeSubtitleAppearance}
          onSkip={skipCurrentSegment}
          onNext={() => playNextEpisode(false)}
          onStillWatching={answerStillWatching}
        />
      )}
      {screen === 'postplay' && (
        <PostPlayScreen
          media={postPlayMedia}
          recommendations={postPlayItems}
          authored={Boolean(postPlayMedia.recommendations?.length)}
          focus={postPlayFocus}
          stage={postPlayStage}
          rating={ratingFor(postPlayMedia)}
          ratingTransitioning={postPlayRatingTransitioning}
          miniPlayerEnabled={playbackSettings.postPlayExperienceEnabled}
          nativeVideoAvailable={avplayRef.current.available && Boolean(activeLoadRef.current)}
          onFocus={setPostPlayFocus}
          onRate={answerPostPlayRating}
          onReturnToPlayer={returnToPostPlayPlayer}
          onReplay={() => void playMedia(postPlayMedia)}
          onHome={() => {
            finishActivePlayback()
            clearNavigationHistory()
            restoreHomeNavigation()
          }}
          onRecommendation={(media) => {
            finishActivePlayback()
            selectCatalogMedia(media)
          }}
        />
      )}
      {screen === 'error' && <ErrorScreen message={errorMessage} onRetry={retryPlayback} />}
      {navigationPhase !== 'idle' && ['home', 'search', 'trending', 'series-home', 'series', 'movies', 'my-list', 'settings'].includes(screen) && (
        <NavigationSkeleton screen={screen} leaving={navigationPhase === 'leaving'} />
      )}
      {exitConfirmation && (
        <ExitConfirmation
          focus={exitFocus}
          onFocus={setExitFocus}
          onCancel={() => setExitConfirmation(false)}
          onExit={exitApplication}
        />
      )}
      {showPreviewToolbar && (
        <PreviewToolbar
          screen={screen}
          safeArea={safeArea}
          onScreen={previewScreen}
          onRemote={handleRemote}
          onSafeArea={() => setSafeArea((value) => !value)}
        />
      )}
      {safeArea && <div class="safe-area-guide" aria-hidden="true" />}
    </div>
  )
}
