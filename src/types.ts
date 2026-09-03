export type ScreenName =
  | 'home'
  | 'search'
  | 'trending'
  | 'series'
  | 'movies'
  | 'my-list'
  | 'settings'
  | 'details'
  | 'ready'
  | 'loading'
  | 'player'
  | 'postplay'
  | 'error'
export type PlaybackState = 'idle' | 'buffering' | 'playing' | 'paused'

export interface MediaRef {
  provider: 'anilist' | 'kitsu' | 'tmdb' | string
  id: string
  type: 'anime' | 'manga' | 'movie' | 'tv' | string
}

export interface CompanionMedia {
  ref: MediaRef
  /** Non-secret hint used only when this TV's private Worker resolver is explicitly enabled. */
  resolver?: { streamType: 'movie' | 'series' }
  /** Transient intent used when the TV asks a linked Izumi client for a replacement source. */
  playback?: { selection: 'manual'; positionSeconds?: number }
  title: string
  subtitle?: string
  description?: string
  contentRating?: string
  poster?: string
  backdrop?: string
  trailer?: { id: string; site?: string }
  progress?: number
  episode?: number
  episodeTitle?: string
  episodeImage?: string
  season?: number
  episodeProgress?: number
  episodeRuntimeMinutes?: number
  /** True only when the paired catalogue reports this title in the user's library. */
  inMyList?: boolean
  /** Episode counts for each season represented by this catalog title. */
  seasonEpisodeCounts?: number[]
  /** Optional human-readable labels for the corresponding season entries. */
  seasonLabels?: string[]
  /** Optional episode metadata supplied by Stremio or another paired catalogue. */
  episodes?: CompanionEpisode[]
  /** Provider relations kept shallow so the TV can present sequels, films and side stories. */
  relations?: CompanionRelation[]
  /** Provider-authored recommendations kept shallow for the post-play experience. */
  recommendations?: CompanionMedia[]
  placement?: {
    label: string
    position?: number
    kind: 'continue' | 'ranking' | 'recommendation' | 'catalog'
  }
}

export interface CompanionEpisode {
  season: number
  episode: number
  title?: string
  description?: string
  image?: string
  runtimeMinutes?: number
  /** Normalized 0–1 position for this episode. */
  progress?: number
  watched?: boolean
  /** The paired client marked this unwatched episode for spoiler-safe presentation. */
  spoiler?: boolean
  /** ISO release timestamp when the catalogue supplies one. */
  releasedAt?: string
}

export type CompanionSkipSegmentType =
  | 'intro'
  | 'op'
  | 'mixed-op'
  | 'recap'
  | 'outro'
  | 'ed'
  | 'mixed-ed'
  | 'credits'
  | 'ending'

export interface CompanionSkipSegment {
  type: CompanionSkipSegmentType
  startTime: number
  endTime: number
  label?: string
}

export interface CompanionRelation {
  relationType: string
  media: CompanionMedia
}

export interface CompanionHomeRow {
  id: string
  title: string
  kind: 'continue' | 'catalog'
  /** Optional TV-specific visual treatment for an ordered catalogue. */
  presentation?: 'standard' | 'top-10'
  items: CompanionMedia[]
}

export interface CompanionCatalogOption {
  screen: string
  label: string
}

export interface CompanionHomeSnapshot {
  app: 'izumi'
  kind: 'companion-home'
  version: 1
  revision: string
  generatedAt: number
  catalog: { screen: string; label: string; options?: CompanionCatalogOption[] }
  /** Mirrors the paired Izumi client's interface preference. */
  spoilersHidden?: boolean
  hero?: CompanionMedia
  rows: CompanionHomeRow[]
  /** Optional provider-authored collections for TV navigation; never inferred from recommendations. */
  views?: {
    search?: CompanionMedia[]
    trending?: CompanionMedia[]
    series?: CompanionMedia[]
    movies?: CompanionMedia[]
    myList?: CompanionMedia[]
  }
}

export interface SubtitleStyle {
  enabled?: boolean
  scope?: 'all' | 'dialogue'
  font?: string
  bold?: boolean
  fontSize?: number
  textColor?: string
  borderColor?: string
  borderSize?: number
  shadow?: number
  position?: number
}

export interface CastSubtitleTrack {
  id?: number
  url: string
  title?: string
  lang?: string
  contentType?: string
}

export interface CastTrackPreference {
  language?: string
  title?: string
  codec?: string
}

export interface CastTrackPreferences {
  audio?: CastTrackPreference
  subtitle?: CastTrackPreference
}

export interface CastLoadRequest {
  sessionId: string
  url: string
  title: string
  contentRating?: string
  contentType?: string
  positionSeconds: number
  subtitles: CastSubtitleTrack[]
  activeTrackIds: number[]
  media?: CompanionMedia
  /** Normalized segments resolved by Izumi (AniSkip, IntroDB or file chapters). */
  skipSegments?: CompanionSkipSegment[]
  trackPreferences?: CastTrackPreferences
  subtitleStyle?: SubtitleStyle
  adaptive?: {
    minBitrateKbps?: number
    maxBitrateKbps?: number
    startBitrate?: 'LOWEST' | 'AVERAGE' | 'HIGHEST' | number
  }
  drm?: {
    system: 'playready' | 'widevine'
    licenseServer: string
    headers?: Record<string, string>
    customData?: string
    deleteLicenseAfterUse?: boolean
  }
  cookies?: string
  userAgent?: string
}

export interface PlaybackSourceChoice {
  id: string
  label: string
  detail?: string
  request: CastLoadRequest
}

export type CastControlRequest = {
  sessionId: string
  action: 'status' | 'play' | 'pause' | 'seek' | 'tracks' | 'volume' | 'stop'
  exitApp?: boolean
  positionSeconds?: number
  activeTrackIds?: number[]
  volume?: number
  muted?: boolean
}

export interface PlaybackSnapshot {
  sessionId: string
  state: PlaybackState
  positionSeconds: number
  durationSeconds?: number
  volume?: number
  muted?: boolean
  subtitleState?: 'off' | 'loading' | 'ready' | 'error'
  subtitleTitle?: string
  activeTrackIds?: number[]
  subtitleError?: string
  error?: string
  forced?: boolean
}

export interface PairingInfo {
  deviceId: string
  challenge: string
  expiresAt: number
  address: string
  link: string
}

export type CompanionPlaybackMode = 'device-only' | 'cloud-only' | 'cloud-and-device'

export interface CompanionCloudflareTransport {
  protocol: 1
  endpoint: string
  pairingId: string
  tvToken: string
  playbackMode: CompanionPlaybackMode
  wakeWhenClosed: boolean
}

export interface PlaybackTrack {
  type: 'AUDIO' | 'TEXT'
  index: number
  label: string
  language?: string
  codec?: string
}

/** Opaque source identity owned by the linked device. URLs and credentials remain on that device. */
export interface LinkedDeviceSourceChoice {
  id: string
  label: string
  detail?: string
}

export interface LinkedDeviceSourceOptions {
  requestId: string
  choices: LinkedDeviceSourceChoice[]
  resolving: boolean
  error?: string
}

export interface SubtitleChoice {
  id: string
  label: string
  kind: 'off' | 'embedded' | 'external'
  index?: number
  url?: string
  contentType?: string
}

export interface SubtitlePreferences {
  size: 'source' | 'small' | 'medium' | 'large'
  background: 'source' | 'none' | 'shadow' | 'box'
  delayMs: number
  /** Appearance override already supplied by the paired izumi client. */
  castStyle?: SubtitleStyle
}

export type PlayerMenu = 'source' | 'audio' | 'subtitles' | 'appearance'

export type FocusLocation =
  | { zone: 'nav'; index: number }
  | { zone: 'hero'; index: number }
  | { zone: 'row'; row: number; index: number }
  | { zone: 'grid'; index: number }
  | { zone: 'keyboard'; index: number }
  | { zone: 'search-input'; index: number }
  | { zone: 'suggestion'; index: number }
  | { zone: 'catalog'; index: number }
  | { zone: 'series-season'; index: number }
  | { zone: 'series-action'; index: number }
  | { zone: 'episode'; index: number }
  | { zone: 'relation'; index: number }
  | { zone: 'setting'; index: number }
  | { zone: 'detail'; index: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isCompanionMedia(value: unknown): value is CompanionMedia {
  if (!isRecord(value) || typeof value.title !== 'string' || !isRecord(value.ref)) return false
  return typeof value.ref.provider === 'string'
    && typeof value.ref.id === 'string'
    && typeof value.ref.type === 'string'
}

export function isCompanionSnapshot(value: unknown): value is CompanionHomeSnapshot {
  if (!isRecord(value) || !isRecord(value.catalog) || !Array.isArray(value.rows)) return false
  const catalogOptions = value.catalog.options
  if (catalogOptions !== undefined && (!Array.isArray(catalogOptions) || !catalogOptions.every((option) => (
    isRecord(option) && typeof option.screen === 'string' && typeof option.label === 'string'
  )))) return false
  const rowsAreValid = value.rows.every((row) => (
    isRecord(row)
    && typeof row.id === 'string'
    && typeof row.title === 'string'
    && (row.kind === 'continue' || row.kind === 'catalog')
    && Array.isArray(row.items)
    && row.items.every(isCompanionMedia)
  ))
  const views = isRecord(value.views) ? value.views : null
  const viewsAreValid = value.views === undefined || (views !== null && (
    ['search', 'trending', 'series', 'movies', 'myList'] as const
  ).every((key) => views[key] === undefined || (
    Array.isArray(views[key]) && views[key].every(isCompanionMedia)
  )))
  return value.app === 'izumi'
    && value.kind === 'companion-home'
    && value.version === 1
    && typeof value.revision === 'string'
    && typeof value.generatedAt === 'number'
    && typeof value.catalog.screen === 'string'
    && typeof value.catalog.label === 'string'
    && (value.hero === undefined || isCompanionMedia(value.hero))
    && rowsAreValid
    && viewsAreValid
}
