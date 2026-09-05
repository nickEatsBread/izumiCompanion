import { readDiscoveryChoices, persistDiscoveryChoice, validDiscoveryChoice, discoveryKey, type DiscoveryChoice } from './discovery'
import type {
  CastControlRequest,
  CastLoadRequest,
  CompanionHomeSnapshot,
  CompanionCloudflareTransport,
  CompanionMedia,
  CompanionPersonFilter,
  PairingInfo,
  PlaybackSnapshot,
  PlaybackSourceChoice,
  CastTrackPreference,
  LinkedDeviceSourceOptions,
} from '../types'
import { isCompanionSnapshot } from '../types'
import { cloudResolveRequest, cloudResolveSelection } from './cloud-resolver'
import {
  clearPlaybackProgress,
  mergePlaybackProgress,
  readPlaybackProgress,
  savePlaybackProgress,
  type StoredPlaybackProgress,
} from './playback-progress'

import { tvHousehold, tvProfileId, tvProfileReady, tvProfileScope, tvProfileStorageKey, updateTvHousehold, snapshotMatchesTvProfile, filterTvSnapshot, tvAllowsMedia, resetTvHousehold } from './profiles'

const CHANNEL_ID = 'com.nicho.izumi.cast'
const PAIRING_LIFETIME_MS = 5 * 60_000
const LOCAL_PLAY_ACK_MS = 1_200
const REMOTE_REQUEST_TTL_MS = 5 * 60_000
const SNAPSHOT_STORAGE_KEY = 'izumi.companion.snapshot'
// TMDB detail enrichment can itself wait up to eight seconds for an optional external rating.
// Keep the TV request alive beyond that nested timeout so its logo/backdrop result is not discarded
// at precisely the same instant the paired client finishes assembling it.
const DETAILS_TIMEOUT_MS = 15_000
const TRAILER_TIMEOUT_MS = 8_000

export interface CompanionTrailerSource {
  requestId: string
  url: string
}

export type CompanionWorkerSetupStatus = 'opened' | 'starting' | 'dismissed' | 'error'

export type CompanionPlayResult =
  | 'local'
  | 'notified'
  | 'queued'
  | 'open-client'
  | 'worker-error'
  | 'no-source'
  | { kind: 'failed'; message: string }
  | { kind: 'resolved'; request: CastLoadRequest; sources: PlaybackSourceChoice[]; selectedId: string }

export interface ReceiverEvents {
  onConnection(connected: boolean): void
  onPaired(paired: boolean): void
  onPairingInfo(info: PairingInfo): void
  onSnapshot(snapshot: CompanionHomeSnapshot): void
  /** Updates catalogue data without moving the TV away from its current screen or focus. */
  onPlaybackProgress?(snapshot: CompanionHomeSnapshot): void
  onCatalogError?(screen: string, message: string): void
  onSearchResults(query: string, items: CompanionMedia[], error?: string, person?: CompanionPersonFilter, genre?: string): void
  onLoad(request: CastLoadRequest, senderId: string): void
  onControl(request: CastControlRequest, senderId: string): void
  onDeviceSourceAvailability?(available: boolean): void
  onDeviceSourceOptions?(options: LinkedDeviceSourceOptions): void
  onIndependentPlaybackReady?(ready: boolean): void
  onWorkerSetupStatus?(status: CompanionWorkerSetupStatus, message?: string): void
}

function parseMessage(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return undefined }
}

function peerId(from: unknown): string {
  if (typeof from === 'string') return from
  if (from && typeof from === 'object' && 'id' in from) return String(from.id || '')
  return ''
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes)
  try { crypto.getRandomValues(values) } catch {
    for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 256)
  }
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
}

function secureRandomHex(bytes: number): string | null {
  try {
    const values = crypto.getRandomValues(new Uint8Array(bytes))
    return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')
  } catch { return null }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function credentialBytes(value: string): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(32)
  for (let index = 0; index < result.length; index += 1) result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return result
}

function parseCloudflareTransport(value: unknown): CompanionCloudflareTransport | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  if (input.protocol !== 1
    || typeof input.endpoint !== 'string'
    || typeof input.pairingId !== 'string'
    || typeof input.tvToken !== 'string'
    || !/^[A-Za-z0-9_-]{16,80}$/.test(input.pairingId)
    || !/^[A-Za-z0-9_-]{32,128}$/.test(input.tvToken)) return null
  try {
    const endpoint = new URL(input.endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== '/' && endpoint.pathname !== '') return null
    const playbackMode = input.playbackMode === 'cloud-only' || input.playbackMode === 'cloud-and-device'
      ? input.playbackMode
      : 'device-only'
    return {
      protocol: 1,
      endpoint: endpoint.toString().replace(/\/$/, ''),
      pairingId: input.pairingId,
      tvToken: input.tvToken,
      playbackMode,
      // Older routes did not identify whether they came from Android or desktop. Defaulting to no
      // wake avoids queuing a closed desktop request; an open Android app upgrades the policy.
      wakeWhenClosed: input.wakeWhenClosed === true,
    }
  } catch { return null }
}

function storedCloudflareTransport(): CompanionCloudflareTransport | null {
  try { return parseCloudflareTransport(JSON.parse(localStorage.getItem('izumi.companion.cloudflare') || 'null')) } catch { return null }
}

function storedSnapshot(): CompanionHomeSnapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(tvProfileStorageKey(SNAPSHOT_STORAGE_KEY)) || 'null')
    if (isCompanionSnapshot(value)) { updateTvHousehold(value.household); if (snapshotMatchesTvProfile(value)) return filterTvSnapshot(value) }
  } catch { /* Invalid upgrade data is removed below. */ }
  localStorage.removeItem(tvProfileStorageKey(SNAPSHOT_STORAGE_KEY))
  return null
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  const result = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index)
  return result
}

function storeSnapshot(snapshot: CompanionHomeSnapshot): void {
  try { localStorage.setItem(tvProfileStorageKey(SNAPSHOT_STORAGE_KEY), JSON.stringify(snapshot)) } catch { /* TV storage is best-effort. */ }
}

class WorkerRequestError extends Error {
  constructor(message: string, readonly code = '') {
    super(message)
  }
}

function workerRequest(
  transport: CompanionCloudflareTransport,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  payload?: unknown,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const profileId = tvProfileId()
  const scoped = method === 'POST' && /\/(catalog|search|details|resolve)$/.test(path)
  if (scoped && !tvProfileReady()) return Promise.reject(new WorkerRequestError('Choose and unlock a profile first.', 'PROFILE_LOCKED'))
  if (scoped) payload = { ...(payload as Record<string, unknown>), ...tvProfileScope() }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(method, `${transport.endpoint}${path}`, true)
    request.timeout = timeoutMs
    request.setRequestHeader('Authorization', `Bearer ${transport.tvToken}`)
    if (payload !== undefined) request.setRequestHeader('Content-Type', 'application/json')
    request.onload = () => {
      if (scoped && (profileId !== tvProfileId() || !tvProfileReady())) { reject(new WorkerRequestError('The profile changed.', 'PROFILE_CHANGED')); return }
      let value: Record<string, unknown> = {}
      try { value = JSON.parse(request.responseText || '{}') as Record<string, unknown> } catch { /* handled below */ }
      if (request.status >= 200 && request.status < 300) resolve(value)
      else reject(new WorkerRequestError(
        typeof value.error === 'string' ? value.error : `Worker returned ${request.status}.`,
        typeof value.code === 'string' ? value.code : '',
      ))
    }
    request.onerror = () => reject(new Error('The private Worker could not be reached.'))
    request.ontimeout = () => reject(new Error('The private Worker did not respond in time.'))
    request.send(payload === undefined ? null : JSON.stringify(payload))
  })
}

async function encryptedPlayRequest(
  credential: string,
  pairingId: string,
  requestId: string,
  media: CompanionMedia,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const issuedAt = Date.now()
  const plain = new TextEncoder().encode(JSON.stringify({
    v: 1,
    profileId: tvProfileId(),
    pairingId,
    requestId,
    ref: media.ref,
    episode: media.episode,
    season: media.season,
    resolver: media.resolver,
    playback: media.playback,
    issuedAt,
    expiresAt: issuedAt + REMOTE_REQUEST_TTL_MS,
  }))
  const key = await crypto.subtle.importKey('raw', credentialBytes(credential), { name: 'AES-GCM' }, false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`izumi-companion:${pairingId}:${requestId}`),
  }, key, plain)
  return JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) })
}

function validUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 8192 && /^https?:\/\//i.test(value)
}

function validCompanionMedia(value: unknown): value is CompanionMedia {
  if (!value || typeof value !== 'object') return false
  const media = value as Partial<CompanionMedia>
  return typeof media.title === 'string'
    && media.title.length > 0
    && media.title.length <= 240
    && Boolean(media.ref)
    && typeof media.ref?.provider === 'string'
    && typeof media.ref?.type === 'string'
    && typeof media.ref?.id === 'string'
}

async function tvEncryptionKey(transport: CompanionCloudflareTransport, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64UrlToBytes(transport.tvToken), { name: 'AES-GCM' }, false, usages)
}

async function encryptTvPayload(transport: CompanionCloudflareTransport, context: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv,
    additionalData: new TextEncoder().encode(`izumi-companion:${transport.pairingId}:${context}`),
  }, await tvEncryptionKey(transport, ['encrypt']), plain)
  return JSON.stringify({ v: 1, iv: bytesToBase64Url(iv), data: bytesToBase64Url(new Uint8Array(encrypted)) })
}

async function decryptTvPayload<T>(transport: CompanionCloudflareTransport, context: string, payload: unknown): Promise<T | null> {
  if (typeof payload !== 'string') return null
  try {
    const envelope = JSON.parse(payload) as { v?: unknown; iv?: unknown; data?: unknown }
    if (envelope.v !== 1 || typeof envelope.iv !== 'string' || typeof envelope.data !== 'string') return null
    const plain = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv),
      additionalData: new TextEncoder().encode(`izumi-companion:${transport.pairingId}:${context}`),
    }, await tvEncryptionKey(transport, ['decrypt']), base64UrlToBytes(envelope.data))
    return JSON.parse(new TextDecoder().decode(plain)) as T
  } catch { return null }
}

async function progressKey(media: CompanionMedia, profileId = tvProfileId()): Promise<string> {
  const identity = `${profileId}:` + `${media.ref.provider}:${media.ref.type}:${media.ref.id}:${media.season ?? ''}:${media.episode ?? ''}`
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))))
}

function focusedHomeTitleDiagnostics(): Record<string, unknown> {
  const card = document.querySelector<HTMLElement>('.home-focus-card.is-focused')
  if (!card) return { available: false }
  const elementState = (element: HTMLElement | null) => {
    if (!element) return null
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      zIndex: style.zIndex,
      bounds: [Math.round(bounds.left), Math.round(bounds.top), Math.round(bounds.width), Math.round(bounds.height)],
    }
  }
  const logo = card.querySelector<HTMLImageElement>('.home-focus-logo')
  const title = card.querySelector<HTMLElement>('.home-focus-title')
  return {
    available: true,
    label: card.getAttribute('aria-label') ?? '',
    treatment: card.getAttribute('data-title-treatment') ?? '',
    cardClass: card.className,
    logo: logo ? {
      ...elementState(logo),
      source: logo.currentSrc || logo.src,
      complete: logo.complete,
      naturalSize: [logo.naturalWidth, logo.naturalHeight],
    } : null,
    title: title ? { ...elementState(title), text: title.textContent?.trim() ?? '' } : null,
    pending: elementState(card.querySelector<HTMLElement>('.home-focus-title-pending')),
    media: elementState(card.querySelector<HTMLElement>('.home-focus-media')),
    trailer: elementState(card.querySelector<HTMLElement>('.home-hover-trailer')),
  }
}

function cloudMediaDetails(value: unknown, media: CompanionMedia): CompanionMedia | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>
  const details = input.details && typeof input.details === 'object' ? input.details as Record<string, unknown> : null
  if (!details) return null
  const hideSpoilers = storedSnapshot()?.spoilersHidden === true
  const episodes = (Array.isArray(details.episodes) ? details.episodes : []).slice(0, 2_000).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const episode = entry as Record<string, unknown>
    const seasonNumber = Number(episode.season)
    const episodeNumber = Number(episode.episode)
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0
      || !Number.isInteger(episodeNumber) || episodeNumber < 1) return []
    const saved = media.episodes?.find((item) => item.season === seasonNumber && item.episode === episodeNumber)
    const current = seasonNumber === (media.season ?? 1) && episodeNumber === media.episode
    const progress = current && Number.isFinite(media.episodeProgress) ? media.episodeProgress
      : saved?.progress ?? (typeof episode.progress === 'number' && Number.isFinite(episode.progress) ? Math.max(0, Math.min(1, episode.progress)) : undefined)
    const watched = progress !== undefined ? progress >= 1 : saved?.watched
      ?? (typeof episode.watched === 'boolean' ? episode.watched
        : seasonNumber === (media.season ?? 1) && episodeNumber < (media.episode ?? 1))
    const runtime = Number(episode.runtimeMinutes)
    return [{
      season: seasonNumber,
      episode: episodeNumber,
      title: typeof episode.title === 'string' ? episode.title.slice(0, 300) : undefined,
      description: typeof episode.description === 'string' ? episode.description.slice(0, 1_500) : undefined,
      image: validUrl(episode.image) ? episode.image : undefined,
      runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? Math.max(1, Math.round(runtime)) : undefined,
      releasedAt: typeof episode.releasedAt === 'string' ? episode.releasedAt.slice(0, 40) : undefined,
      videoId: typeof episode.videoId === 'string' ? episode.videoId.slice(0, 500) : undefined,
      progress: watched ? 1 : progress,
      watched,
      spoiler: hideSpoilers && !watched,
    }]
  })
  const suppliedCounts = Array.isArray(details.seasonEpisodeCounts)
    ? details.seasonEpisodeCounts.slice(0, 100).map(Number).filter((count) => Number.isInteger(count) && count > 0)
    : []
  const derivedCounts = new Map<number, number>()
  episodes.forEach((episode) => derivedCounts.set(episode.season, Math.max(derivedCounts.get(episode.season) ?? 0, episode.episode)))
  const labels = Array.isArray(details.seasonLabels)
    ? details.seasonLabels.slice(0, suppliedCounts.length).map((label) => typeof label === 'string' ? label.slice(0, 80) : '')
    : undefined
  const ratings = (Array.isArray(details.ratings) ? details.ratings : []).slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const rating = entry as Record<string, unknown>
    const source = typeof rating.source === 'string' ? rating.source.slice(0, 80) : ''
    const score = Number(rating.score)
    const scale = Number(rating.scale)
    const votes = Number(rating.votes)
    if (!source || !Number.isFinite(score) || ![5, 10, 100].includes(scale)) return []
    return [{ source, score, scale: scale as 5 | 10 | 100, votes: Number.isFinite(votes) && votes >= 0 ? votes : undefined }]
  })
  const people = (value: unknown, credit: 'cast' | 'crew') => (Array.isArray(value) ? value : []).slice(0, 30).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const person = entry as Record<string, unknown>
    if (typeof person.id !== 'string' || typeof person.provider !== 'string' || typeof person.name !== 'string') return []
    return [{
      id: person.id.slice(0, 80),
      provider: person.provider.slice(0, 40),
      name: person.name.slice(0, 160),
      role: typeof person.role === 'string' ? person.role.slice(0, 160) : undefined,
      image: validUrl(person.image) ? person.image : undefined,
      credit,
    }]
  })
  const cast = people(details.cast, 'cast')
  const crew = people(details.crew, 'crew')
  const relations = (Array.isArray(details.relations) ? details.relations : []).slice(0, 12).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const relation = entry as Record<string, unknown>
    return typeof relation.relationType === 'string' && validCompanionMedia(relation.media)
      && tvAllowsMedia(relation.media) ? [{ relationType: relation.relationType.slice(0, 80), media: relation.media }]
      : []
  })
  const recommendations = (Array.isArray(details.recommendations) ? details.recommendations : [])
    .slice(0, 12).filter(validCompanionMedia).filter(tvAllowsMedia)
  return {
    ...media,
    contentRating: typeof details.contentRating === 'string' ? details.contentRating : media.contentRating,
    isAdult: details.isAdult === true || media.isAdult === true,
    description: typeof details.description === 'string' ? details.description.slice(0, 1_500) : media.description,
    poster: validUrl(details.poster) ? details.poster : media.poster,
    backdrop: validUrl(details.backdrop) ? details.backdrop : media.backdrop,
    logoImage: validUrl(details.logoImage) ? details.logoImage : media.logoImage,
    genres: Array.isArray(details.genres)
      ? details.genres.slice(0, 20).flatMap((entry) => typeof entry === 'string' ? [entry.slice(0, 80)] : [])
      : media.genres,
    runtimeMinutes: Number.isFinite(Number(details.runtimeMinutes)) ? Number(details.runtimeMinutes) : media.runtimeMinutes,
    ratings: ratings.length ? ratings : media.ratings,
    cast: cast.length ? cast : media.cast,
    crew: crew.length ? crew : media.crew,
    relations: relations.length ? relations : media.relations,
    recommendations: recommendations.length ? recommendations : media.recommendations,
    trailer: details.trailer && typeof details.trailer === 'object'
      && typeof (details.trailer as Record<string, unknown>).id === 'string'
      ? {
          id: String((details.trailer as Record<string, unknown>).id).slice(0, 40),
          site: 'youtube',
          language: typeof (details.trailer as Record<string, unknown>).language === 'string'
            ? String((details.trailer as Record<string, unknown>).language).slice(0, 24)
            : undefined,
        }
      : media.trailer,
    episodes: episodes.length ? episodes : media.episodes,
    seasonEpisodeCounts: suppliedCounts.length
      ? suppliedCounts
      : derivedCounts.size ? [...derivedCounts.entries()].sort(([left], [right]) => left - right).map(([, count]) => count) : media.seasonEpisodeCounts,
    seasonLabels: labels?.every(Boolean) ? labels : undefined,
  }
}

function linkedDeviceSourceOptions(value: unknown): LinkedDeviceSourceOptions | undefined {
  const message = parseMessage(value)
  if (!message || typeof message !== 'object') return undefined
  const input = message as Record<string, unknown>
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(input.requestId)) return undefined
  const choices = (Array.isArray(input.choices) ? input.choices : []).slice(0, 40).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const choice = entry as Record<string, unknown>
    if (typeof choice.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(choice.id)
      || typeof choice.label !== 'string' || !choice.label.trim()) return []
    return [{
      id: choice.id,
      label: choice.label.trim().slice(0, 180),
      detail: typeof choice.detail === 'string' ? choice.detail.trim().slice(0, 240) : undefined,
    }]
  })
  return {
    requestId: input.requestId,
    choices,
    resolving: input.resolving === true,
    error: typeof input.error === 'string' ? input.error.slice(0, 240) : undefined,
  }
}

function trackPreference(value: unknown): CastTrackPreference | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const language = typeof input.language === 'string' ? input.language.trim().slice(0, 40) : undefined
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 160) : undefined
  const codec = typeof input.codec === 'string' ? input.codec.trim().slice(0, 80) : undefined
  return language || title || codec ? { language, title, codec } : undefined
}

function trackHints(value: unknown): CastLoadRequest['trackHints'] {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const subtitles = (Array.isArray(input.subtitles) ? input.subtitles : []).slice(0, 16).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const hint = entry as Record<string, unknown>
    const label = typeof hint.label === 'string' ? hint.label.trim().slice(0, 160) : ''
    if (!label) return []
    return [{
      label,
      language: typeof hint.language === 'string' ? hint.language.trim().slice(0, 40) : undefined,
      title: typeof hint.title === 'string' ? hint.title.trim().slice(0, 160) : undefined,
      codec: typeof hint.codec === 'string' ? hint.codec.trim().slice(0, 80) : undefined,
    }]
  })
  return subtitles.length ? { subtitles } : undefined
}

function normalizeLoad(value: unknown): CastLoadRequest | undefined {
  const message = parseMessage(value)
  if (!message || typeof message !== 'object') return undefined
  const input = message as Record<string, unknown>
  if (!validUrl(input.url) || typeof input.sessionId !== 'string' || !input.sessionId || input.sessionId.length > 128) return undefined
  const rawTracks = Array.isArray(input.subtitles) ? input.subtitles : []
  const subtitles = rawTracks.slice(0, 8).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const track = entry as Record<string, unknown>
    if (!validUrl(track.url)) return []
    return [{
      id: Number.isFinite(Number(track.id)) ? Number(track.id) : index + 1,
      url: track.url,
      title: typeof track.title === 'string' ? track.title.slice(0, 160) : undefined,
      lang: typeof track.lang === 'string' ? track.lang.slice(0, 24) : undefined,
      contentType: typeof track.contentType === 'string' ? track.contentType.slice(0, 80) : undefined,
    }]
  })
  const rawAdaptive = input.adaptive && typeof input.adaptive === 'object' ? input.adaptive as Record<string, unknown> : undefined
  const rawDrm = input.drm && typeof input.drm === 'object' ? input.drm as Record<string, unknown> : undefined
  const rawPreferences = input.trackPreferences && typeof input.trackPreferences === 'object'
    ? input.trackPreferences as Record<string, unknown>
    : undefined
  const audioPreference = trackPreference(rawPreferences?.audio)
  const subtitlePreference = trackPreference(rawPreferences?.subtitle)
  const drmSystem = rawDrm?.system === 'playready' || rawDrm?.system === 'widevine' ? rawDrm.system : undefined
  const drmLicense = rawDrm && validUrl(rawDrm.licenseServer) ? rawDrm.licenseServer : undefined
  const skipTypes = ['intro', 'op', 'mixed-op', 'recap', 'outro', 'ed', 'mixed-ed', 'credits', 'ending']
  const skipSegments = (Array.isArray(input.skipSegments) ? input.skipSegments : []).slice(0, 16).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const segment = value as Record<string, unknown>
    const startTime = Number(segment.startTime)
    const endTime = Number(segment.endTime)
    if (!skipTypes.includes(String(segment.type))
      || !Number.isFinite(startTime)
      || !Number.isFinite(endTime)
      || startTime < 0
      || endTime <= startTime
      || endTime > 604_800) return []
    return [{
      type: segment.type as NonNullable<CastLoadRequest['skipSegments']>[number]['type'],
      startTime,
      endTime,
      label: typeof segment.label === 'string' ? segment.label.trim().slice(0, 80) : undefined,
    }]
  })
  return {
    profileId: typeof input.profileId === 'string' ? input.profileId : 'default',
    sessionId: input.sessionId,
    url: input.url,
    title: typeof input.title === 'string' && input.title ? input.title.slice(0, 240) : 'izumi',
    contentRating: typeof input.contentRating === 'string' ? input.contentRating.slice(0, 32) : undefined,
    contentType: typeof input.contentType === 'string' ? input.contentType.slice(0, 120) : undefined,
    positionSeconds: Math.max(0, Math.min(Number(input.positionSeconds) || 0, 604_800)),
    subtitles,
    activeTrackIds: Array.isArray(input.activeTrackIds)
      ? input.activeTrackIds.slice(0, 1).map(Number).filter(Number.isFinite)
      : [],
    media: validCompanionMedia(input.media) ? input.media : undefined,
    skipSegments,
    trackPreferences: audioPreference || subtitlePreference ? {
      audio: audioPreference,
      subtitle: subtitlePreference,
    } : undefined,
    trackHints: trackHints(input.trackHints),
    subtitleStyle: input.subtitleStyle && typeof input.subtitleStyle === 'object' ? input.subtitleStyle : undefined,
    adaptive: rawAdaptive ? {
      minBitrateKbps: Number.isFinite(Number(rawAdaptive.minBitrateKbps)) ? Math.max(0, Number(rawAdaptive.minBitrateKbps)) : undefined,
      maxBitrateKbps: Number.isFinite(Number(rawAdaptive.maxBitrateKbps)) ? Math.max(0, Number(rawAdaptive.maxBitrateKbps)) : undefined,
      startBitrate: ['LOWEST', 'AVERAGE', 'HIGHEST'].includes(String(rawAdaptive.startBitrate))
        ? rawAdaptive.startBitrate as 'LOWEST' | 'AVERAGE' | 'HIGHEST'
        : Number.isFinite(Number(rawAdaptive.startBitrate)) ? Math.max(0, Number(rawAdaptive.startBitrate)) : undefined,
    } : undefined,
    drm: drmSystem && drmLicense ? {
      system: drmSystem,
      licenseServer: drmLicense,
      headers: rawDrm?.headers && typeof rawDrm.headers === 'object' ? rawDrm.headers as Record<string, string> : undefined,
      customData: typeof rawDrm?.customData === 'string' ? rawDrm.customData.slice(0, 4096) : undefined,
      deleteLicenseAfterUse: rawDrm?.deleteLicenseAfterUse === true,
    } : undefined,
    cookies: typeof input.cookies === 'string' ? input.cookies.slice(0, 4096) : undefined,
    userAgent: typeof input.userAgent === 'string' ? input.userAgent.slice(0, 512) : undefined,
  }
}

function normalizeControl(value: unknown): CastControlRequest | undefined {
  const message = parseMessage(value)
  if (!message || typeof message !== 'object') return undefined
  const input = message as Partial<CastControlRequest>
  const actions: CastControlRequest['action'][] = ['status', 'play', 'pause', 'seek', 'tracks', 'volume', 'stop']
  if (typeof input.sessionId !== 'string' || !actions.includes(input.action as CastControlRequest['action'])) return undefined
  return input as CastControlRequest
}

function privateAddress(): string {
  try {
    const value = window.webapis?.network?.getIp()
    if (value) return value
  } catch { /* Browser preview or unsupported network API. */ }
  return location.hostname || '127.0.0.1'
}

export class CompanionReceiver {
  private channel?: SamsungSmartViewChannel
  private connected = false
  private credential = localStorage.getItem('izumi.companion.credential') ?? ''
  private cloudflare = storedCloudflareTransport()
  private activeSenderId = ''
  private activeSessionId = ''
  private pairing = this.createPairingInfo()
  private pairingTimer?: number
  private playAcknowledgements = new Map<string, (accepted: boolean) => void>()
  private deviceSourceRequests = new Map<string, number>()
  private detailRequests = new Map<string, (media: CompanionMedia | null) => void>()
  private trailerRequests = new Map<string, (source: CompanionTrailerSource | null, error?: string) => void>()
  private prefetchedPlays = new Map<string, { expiresAt: number; result: Extract<CompanionPlayResult, { kind: 'resolved' }> }>()
  private workerSetupRequestId = ''
  private activePlayback?: { sessionId: string; media: CompanionMedia; profileId: string }
  private progressSubscriberId = ''
  private cloudPlayback?: { sessionId: string; media: CompanionMedia; profileId: string }
  private localProgressAt = 0
  private cloudProgressAt = 0
  private cloudProgressWriting = false
  private pendingCloudProgress?: PlaybackSnapshot

  constructor(private readonly events: ReceiverEvents) {
    this.events.onPairingInfo(this.pairing)
    this.events.onPaired(Boolean(this.credential))
    this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
    this.events.onIndependentPlaybackReady?.(this.independentPlaybackReady)
    const snapshot = this.credential ? storedSnapshot() : null
    if (snapshot) this.acceptSnapshot(snapshot)
  }

  get pairingInfo(): PairingInfo {
    return this.pairing
  }

  async connect(): Promise<void> {
    await this.refreshHousehold()
    if (!window.msf?.local) {
      // Once a TV has its Worker transport, the LAN receiver is an optional control/fallback
      // channel. A missing Smart View library must not prevent the cloud snapshot from starting.
      if (this.cloudflare && this.credential) {
        await this.refreshCloudSnapshot()
        return
      }
      throw new Error('The Samsung Smart View receiver library did not load.')
    }
    let service: SamsungSmartViewService
    try {
      service = await new Promise<SamsungSmartViewService>((resolve, reject) => {
        window.msf!.local((error, value) => error || !value ? reject(error || new Error('Smart View is unavailable')) : resolve(value))
      })
    } catch (error) {
      if (this.cloudflare && this.credential) {
        await this.refreshCloudSnapshot()
        return
      }
      throw error
    }
    this.channel = service.channel(CHANNEL_ID)
    this.channel.on('izumi.load', (value, from) => {
      const request = normalizeLoad(value)
      const sender = this.messageSender(value, from)
      if (!request || !sender || (request.profileId ?? 'default') !== tvProfileId() || !tvProfileReady() || !tvAllowsMedia(request.media ?? { contentRating: request.contentRating })) return
      this.activeSenderId = sender
      this.activeSessionId = request.sessionId
      this.events.onLoad(request, sender)
    })
    this.channel.on('izumi.control', (value, from) => {
      const request = normalizeControl(value)
      const sender = this.messageSender(value, from)
      if (!request || sender !== this.activeSenderId || request.sessionId !== this.activeSessionId) return
      this.events.onControl(request, sender)
    })
    this.channel.on('izumi.resume', (value, from) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      const sender = this.messageSender(value, from)
      if (!sender || input.sessionId !== this.activeSessionId) return
      this.activeSenderId = sender
      this.events.onControl({ sessionId: this.activeSessionId, action: 'status' }, sender)
    })
    this.channel.on('izumi.companion.pair', (value, from) => this.receivePair(value, peerId(from)))
    this.channel.on('izumi.companion.transport', (value, from) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      const transport = parseCloudflareTransport(input.cloudflare)
      if (!this.credential || input.credential !== this.credential || !transport) return
      this.cloudflare = transport
      localStorage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
      this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
      this.events.onIndependentPlaybackReady?.(this.independentPlaybackReady)
      this.publish('izumi.companion.transport-ready', {
        pairingId: transport.pairingId,
      }, peerId(from) || 'host')
    })
    this.channel.on('izumi.companion.worker-setup-status', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      const allowed: CompanionWorkerSetupStatus[] = ['opened', 'starting', 'dismissed', 'error']
      if (!this.credential
        || input.credential !== this.credential
        || input.requestId !== this.workerSetupRequestId
        || !allowed.includes(input.status as CompanionWorkerSetupStatus)) return
      const status = input.status as CompanionWorkerSetupStatus
      this.events.onWorkerSetupStatus?.(status, typeof input.message === 'string' ? input.message.slice(0, 180) : undefined)
      if (status === 'dismissed' || status === 'error') this.workerSetupRequestId = ''
    })
    this.channel.on('izumi.companion.snapshot', (value) => this.receiveSnapshot(value))
    this.channel.on('izumi.companion.progress-request', (value, from) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential || input.credential !== this.credential) return
      const target = peerId(from)
      if (!target) return
      this.progressSubscriberId = target
      this.publish('izumi.companion.progress-result', {
        credential: this.credential,
        records: readPlaybackProgress(),
      }, target)
    })
    this.channel.on('izumi.companion.catalog-result', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential
        || input.pairingId !== this.credential.slice(0, 16)
        || typeof input.screen !== 'string'
        || typeof input.error !== 'string') return
      this.events.onCatalogError?.(input.screen.slice(0, 40), input.error.slice(0, 240))
    })
    this.channel.on('izumi.companion.search-results', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential || input.credential !== this.credential || typeof input.query !== 'string'
        || !tvProfileReady() || (input.profileId ?? 'default') !== tvProfileId()) return
      const items = Array.isArray(input.items) ? input.items.slice(0, 40).filter(validCompanionMedia).filter(tvAllowsMedia) : []
      const candidate = input.person && typeof input.person === 'object' ? input.person as Record<string, unknown> : undefined
      const person: CompanionPersonFilter | undefined = candidate
        && typeof candidate.id === 'string' && typeof candidate.provider === 'string' && typeof candidate.name === 'string'
        && (candidate.credit === 'cast' || candidate.credit === 'crew')
        ? { id: candidate.id, provider: candidate.provider, name: candidate.name, credit: candidate.credit }
        : undefined
      const genre = typeof input.genre === 'string' ? input.genre.trim().slice(0, 80) : undefined
      this.events.onSearchResults(
        input.query.slice(0, 80),
        items,
        typeof input.error === 'string' ? input.error.slice(0, 240) : undefined,
        person,
        genre,
      )
    })
    this.channel.on('izumi.companion.details-result', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential || input.credential !== this.credential || typeof input.requestId !== 'string') return
      const finish = this.detailRequests.get(input.requestId)
      if (!finish) return
      finish(validCompanionMedia(input.media) ? input.media : null)
    })
    // A credential-authenticated support probe makes physical-TV paint failures diagnosable on
    // 2018 models, whose firmware exposes neither sdb shell nor Web Inspector debug mode.
    this.channel.on('izumi.companion.render-diagnostics', (value, from) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential || input.credential !== this.credential
        || typeof input.requestId !== 'string'
        || !/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId)) return
      const reply = () => this.publish('izumi.companion.render-diagnostics-result', {
        requestId: input.requestId,
        homeTitle: focusedHomeTitleDiagnostics(),
      }, peerId(from) || 'host')
      if (input.action === 'focus-first-row') {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true,
        }))
        window.setTimeout(reply, 700)
      } else reply()
    })
    this.channel.on('izumi.companion.trailer-result', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (!this.credential || input.credential !== this.credential || typeof input.requestId !== 'string') return
      const finish = this.trailerRequests.get(input.requestId)
      if (!finish) return
      finish(validUrl(input.url) ? { requestId: input.requestId, url: input.url } : null,
        typeof input.error === 'string' ? input.error.slice(0, 240) : undefined)
    })
    this.channel.on('izumi.companion.unpair', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      if ((message as Record<string, unknown>).credential === this.credential) this.unpair(false)
    })
    this.channel.on('izumi.companion.play-accepted', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      if (input.pairingId !== (this.cloudflare?.pairingId ?? this.credential.slice(0, 16)) || typeof input.requestId !== 'string') return
      this.playAcknowledgements.get(input.requestId)?.(true)
    })
    this.channel.on('izumi.companion.source-options', (value) => {
      const message = parseMessage(value)
      if (!message || typeof message !== 'object') return
      const input = message as Record<string, unknown>
      const options = linkedDeviceSourceOptions(input)
      const expiresAt = options ? this.deviceSourceRequests.get(options.requestId) : undefined
      if (!options || input.credential !== this.credential || !expiresAt || expiresAt <= Date.now()) return
      this.events.onDeviceSourceOptions?.(options)
    })
    this.channel.on('clientConnect', (_value, from) => {
      const target = peerId(from) || peerId(_value)
      this.publish('izumi.ready', { protocol: 1, subtitles: ['vtt', 'srt', 'ass', 'ssa'] }, target)
      this.sendChallenge(target)
    })
    await new Promise<void>((resolve, reject) => {
      this.channel!.connect({ name: 'izumi companion' }, (error) => error ? reject(error) : resolve())
    })
    this.connected = true
    this.events.onConnection(true)
    this.sendChallenge('broadcast')
    this.pairingTimer = window.setInterval(() => this.sendChallenge('broadcast'), 10_000)
  }

  private async cloudProgressRecords(): Promise<Array<{
    profileId: string
    media: CompanionMedia
    positionSeconds: number
    durationSeconds: number
    completed: boolean
    updatedAt: number
  }>> {
    if (!this.cloudflare || !crypto.subtle) return []
    const result = await workerRequest(
      this.cloudflare,
      `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/progress`,
      'GET',
    )
    const rows = Array.isArray(result.records) ? result.records.slice(0, 200) : []
    const decrypted = await Promise.all(rows.map(async (entry) => {
      if (!entry || typeof entry !== 'object') return null
      const row = entry as Record<string, unknown>
      if (typeof row.mediaKey !== 'string') return null
      return decryptTvPayload<Record<string, unknown>>(this.cloudflare!, `progress:${row.mediaKey}`, row.payload)
    }))
    return decrypted.flatMap((value) => {
      if (!value || (value.profileId ?? 'default') !== tvProfileId() || !validCompanionMedia(value.media)) return []
      const positionSeconds = Number(value.positionSeconds)
      const durationSeconds = Number(value.durationSeconds)
      const updatedAt = Number(value.updatedAt)
      if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || !Number.isFinite(updatedAt)) return []
      return [{
        profileId: typeof value.profileId === 'string' ? value.profileId : 'default',
        media: value.media,
        positionSeconds: Math.max(0, positionSeconds),
        durationSeconds: Math.max(0, durationSeconds),
        completed: value.completed === true,
        updatedAt,
      }]
    })
  }

  private async withCloudProgress(snapshot: CompanionHomeSnapshot): Promise<CompanionHomeSnapshot> {
    const records = await this.cloudProgressRecords().catch(() => [])
    const cloudRecords: StoredPlaybackProgress[] = records.map((record) => ({
      ...record,
      recordKey: [
        `${record.media.ref.provider}:${record.media.ref.type}:${record.media.ref.id}`,
        record.media.season ?? '',
        record.media.episode ?? '',
      ].join(':'),
    }))
    return mergePlaybackProgress(snapshot, [...cloudRecords, ...readPlaybackProgress()])
  }

  private async refreshCloudSnapshot(screen?: string): Promise<boolean> {
    if (!this.cloudflare || !crypto.subtle) return false
    const requestedProfile = tvProfileId()
    const selector = screen && tvHousehold().enabled ? `${requestedProfile}~${screen}` : screen
    const query = selector ? `?screen=${encodeURIComponent(selector)}` : ''
    try {
      const result = await workerRequest(
        this.cloudflare,
        `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/snapshots${query}`,
        'GET',
      )
      if (typeof result.screen !== 'string') return false
      const snapshot = await decryptTvPayload<CompanionHomeSnapshot>(
        this.cloudflare, `snapshot:${result.screen}`, result.payload,
      )
      if (!isCompanionSnapshot(snapshot)) return false
      updateTvHousehold(snapshot.household)
      if (requestedProfile !== tvProfileId() || !snapshotMatchesTvProfile(snapshot) || !tvProfileReady()) return false
      const merged = await this.withCloudProgress(snapshot)
      if (requestedProfile !== tvProfileId()) return false
      return this.acceptSnapshot(merged)
    } catch { return false }
  }

  private async refreshHousehold(): Promise<void> {
    if (!this.cloudflare) return
    try {
      const result = await workerRequest(this.cloudflare, `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/household`, 'GET')
      updateTvHousehold(result.household)
    } catch { /* Offline or older Worker: retain the last authenticated household gate. */ }
  }

  requestRefresh(): void {
    void this.refreshHousehold()
    void this.refreshCloudSnapshot() // Latest roster may belong to another profile; never display its personal rows.
    const screen = storedSnapshot()?.catalog.screen
    void this.refreshCloudSnapshot(screen)
    this.publish('izumi.companion.refresh', { protocol: 1 }, 'broadcast')
  }

  get independentPlaybackReady(): boolean {
    return Boolean(this.cloudflare && this.cloudflare.playbackMode !== 'device-only')
  }

  /** Persist the TV-scoped capability received through the stateless phone handoff. */
  adoptStandaloneTransport(value: unknown): void {
    const transport = parseCloudflareTransport(value)
    if (!transport || transport.playbackMode === 'device-only') throw new Error('The Cloudflare TV setup is invalid.')
    const credential = this.credential || secureRandomHex(32)
    if (!credential) throw new Error('This TV could not create secure local credentials.')
    const previousCredential = localStorage.getItem('izumi.companion.credential')
    const previousTransport = localStorage.getItem('izumi.companion.cloudflare')
    try {
      localStorage.setItem('izumi.companion.credential', credential)
      localStorage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
    } catch {
      if (previousCredential === null) localStorage.removeItem('izumi.companion.credential')
      else localStorage.setItem('izumi.companion.credential', previousCredential)
      if (previousTransport === null) localStorage.removeItem('izumi.companion.cloudflare')
      else localStorage.setItem('izumi.companion.cloudflare', previousTransport)
      throw new Error('This TV could not save the Cloudflare setup.')
    }
    if (this.cloudflare && (this.cloudflare.endpoint !== transport.endpoint || this.cloudflare.pairingId !== transport.pairingId)) {
      void this.revokeCloudflarePairing()
    }
    this.credential = credential
    this.cloudflare = transport
    this.events.onPaired(true)
    this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
    this.events.onIndependentPlaybackReady?.(true)
    // The Worker maps an unsupported "auto" request to the profile's configured default, so this
    // starts either the AniList, TMDB or Stremio home selected during phone setup.
    void this.refreshHousehold().then(() => this.requestCatalog('auto'))
  }

  /** Ask the authenticated, currently linked izumi client to open the private Worker onboarding. */
  requestIndependentSetup(): boolean {
    if (!this.credential || !this.connected) return false
    this.workerSetupRequestId = randomHex(12)
    this.publish('izumi.companion.worker-setup', {
      credential: this.credential,
      pairingId: this.credential.slice(0, 16),
      requestId: this.workerSetupRequestId,
    }, 'broadcast')
    return true
  }

  async sendDiscoveryChoice(choice: DiscoveryChoice): Promise<boolean> {
    if (!validDiscoveryChoice(choice) || !tvProfileReady()) return false
    if (this.credential && this.connected) {
      this.publish('izumi.companion.discovery', { credential: this.credential, choices: [choice] }, 'broadcast')
    }
    const transport = this.cloudflare
    if (!transport || !crypto.subtle) return false
    const mediaKey = bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(choice.profileId + ':' + discoveryKey(choice.media)))))
    const payload = await encryptTvPayload(transport, `discovery:${mediaKey}`, choice)
    await workerRequest(transport, `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/discovery`, 'PUT', { mediaKey, payload, at: choice.at })
    return true
  }

  async syncDiscoveryChoices(): Promise<void> {
    const profile = tvProfileId(), transport = this.cloudflare
    const choices = Object.values(readDiscoveryChoices())
    if (this.credential && this.connected) this.publish('izumi.companion.discovery', { credential: this.credential, choices: choices.slice(0, 100) }, 'broadcast')
    if (!transport || !tvProfileReady()) return
    for (const choice of choices.filter(choice => choice.pending).slice(0, 20)) {
      if (profile !== tvProfileId()) return
      try { if (await this.sendDiscoveryChoice(choice) && profile === tvProfileId()) persistDiscoveryChoice({ ...choice, pending: false }) } catch { break }
    }
    const result = await workerRequest(transport, `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/discovery`, 'GET')
    for (const row of (Array.isArray(result.records) ? result.records : []).slice(0, 500)) {
      if (profile !== tvProfileId()) return
      if (typeof row?.mediaKey !== 'string' || typeof row.payload !== 'string') continue
      const choice = await decryptTvPayload<DiscoveryChoice>(transport, `discovery:${row.mediaKey}`, row.payload)
      if (profile === tvProfileId() && validDiscoveryChoice(choice)) persistDiscoveryChoice({ ...choice, pending: false })
    }
  }

  /** Read a merged cloud catalog without navigating away or replacing the active Home screen. */
  async discoveryCandidates(): Promise<CompanionMedia[]> {
    const profile = tvProfileId()
    if (!this.cloudflare || !tvProfileReady()) return []
    const result = await workerRequest(this.cloudflare, `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/catalog`, 'POST', { screen: 'merged' }, 20_000)
    if (profile !== tvProfileId() || !isCompanionSnapshot(result.snapshot) || !snapshotMatchesTvProfile(result.snapshot)) return []
    return result.snapshot.rows.flatMap(row => row.items).filter(tvAllowsMedia)
  }

  async requestDetails(media: CompanionMedia, presentationOnly = false): Promise<CompanionMedia | null> {
    const viewer = tvProfileId()
    if (!tvProfileReady() || !tvAllowsMedia(media)) return null
    if (this.cloudflare && media.ref.provider !== 'jvm'
      && (!presentationOnly || !this.connected || this.cloudflare.playbackMode === 'cloud-only')) {
      try {
        const result = await workerRequest(
          this.cloudflare,
          `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/details`,
          'POST',
          media,
          6_000,
        )
        const details = cloudMediaDetails(result, media)
        if (details && tvAllowsMedia(details)) return details
      } catch { /* The open paired client remains the richer fallback for unsupported/offline metadata. */ }
    }
    if (!this.credential || !this.connected) return null
    const requestId = randomHex(12)
    return new Promise((resolve) => {
      const finish = (details: CompanionMedia | null) => {
        window.clearTimeout(timer)
        this.detailRequests.delete(requestId)
        resolve(viewer === tvProfileId() && tvProfileReady() && details && tvAllowsMedia(details) ? details : null)
      }
      const timer = window.setTimeout(() => finish(null), DETAILS_TIMEOUT_MS)
      this.detailRequests.set(requestId, finish)
      this.publish('izumi.companion.details', {
        pairingId: this.credential.slice(0, 16),
        requestId,
        media,
        presentationOnly,
      }, 'broadcast')
    })
  }

  async requestTrailer(videoId: string, title: string, muted = false, captions = false): Promise<CompanionTrailerSource> {
    if (!tvProfileReady()) throw new Error('Choose a profile first.')
    if (!this.credential) throw new Error('Pair this TV with izumi to play trailers.')
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return Promise.reject(new Error('This trailer has an invalid YouTube ID.'))

    let cloudError = ''
    if (this.cloudflare) {
      try {
        const result = await workerRequest(
          this.cloudflare,
          `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/trailer`,
          'POST',
          { videoId, muted, captions },
          TRAILER_TIMEOUT_MS,
        )
        if (typeof result.requestId !== 'string' || !/^cloud-[A-Za-z0-9_-]{12,64}$/.test(result.requestId)
          || typeof result.url !== 'string') throw new Error('The private Worker returned an invalid trailer ticket.')
        const ticket = new URL(result.url)
        const endpoint = new URL(this.cloudflare.endpoint)
        if (ticket.origin !== endpoint.origin || ticket.pathname !== '/v1/companion/trailer'
          || ticket.username || ticket.password || ticket.hash
          || !/^[A-Za-z0-9_-]{20,64}$/.test(ticket.searchParams.get('code') || '')) {
          throw new Error('The private Worker returned an unsafe trailer URL.')
        }
        return { requestId: result.requestId, url: ticket.toString() }
      } catch (error) {
        cloudError = error instanceof Error ? error.message : 'The private Worker could not prepare this trailer.'
      }
    }

    if (!this.connected) throw new Error(cloudError || 'Open izumi on the paired device to play this trailer.')
    const requestId = randomHex(12)
    return new Promise((resolve, reject) => {
      const finish = (source: CompanionTrailerSource | null, error?: string) => {
        window.clearTimeout(timer)
        this.trailerRequests.delete(requestId)
        if (source) resolve(source)
        else reject(new Error(error || 'The paired device could not prepare this trailer.'))
      }
      const timer = window.setTimeout(() => finish(null, 'The paired device did not prepare the trailer in time.'), TRAILER_TIMEOUT_MS)
      this.trailerRequests.set(requestId, finish)
      this.publish('izumi.companion.trailer', {
        pairingId: this.credential.slice(0, 16),
        requestId,
        videoId,
        title: title.slice(0, 160),
        muted,
        captions,
      }, 'broadcast')
    })
  }

  releaseTrailer(requestId: string): void {
    if (requestId.startsWith('cloud-')) return
    if (!this.credential || !this.connected || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) return
    this.publish('izumi.companion.trailer-close', {
      pairingId: this.credential.slice(0, 16),
      requestId,
    }, 'broadcast')
  }

  async requestPlay(media: CompanionMedia): Promise<CompanionPlayResult> {
    const viewer = tvProfileId()
    if (!tvProfileReady() || !tvAllowsMedia(media)) return { kind: 'failed', message: 'This title is unavailable for this profile.' }
    if (!this.credential) return 'open-client'
    const secureRequestId = secureRandomHex(16)
    const requestId = secureRequestId ?? randomHex(16)
    const pairingId = this.cloudflare?.pairingId ?? this.credential.slice(0, 16)
    const playbackMode = this.cloudflare?.playbackMode ?? 'device-only'
    const prefetched = this.prefetchedPlays.get(this.playKey(media))
    if (prefetched && prefetched.expiresAt > Date.now()) {
      this.prefetchedPlays.delete(this.playKey(media))
      return prefetched.result
    }
    if (prefetched) this.prefetchedPlays.delete(this.playKey(media))

    if (this.cloudflare && playbackMode !== 'device-only') {
      try {
        const result = await workerRequest(
          this.cloudflare,
          `/v1/companion/pairings/${encodeURIComponent(pairingId)}/resolve`,
          'POST',
          cloudResolveRequest(media),
          30_000,
        )
        const selection = cloudResolveSelection(result, media, requestId)
        if (selection) return { kind: 'resolved', ...selection }
        const failure = Array.isArray(result.failures) && typeof result.failures[0] === 'string'
          ? result.failures[0].slice(0, 240) : ''
        if (failure) return { kind: 'failed', message: failure }
        // A successful Worker response is authoritative. Cloudflare-only never wakes or contacts a
        // linked device; combined mode does so only when the saved profile explicitly requests it.
        if (result.fallback !== 'paired-device') return 'no-source'
      } catch (error) {
        const resolverWasRemoved = error instanceof WorkerRequestError && error.code === 'RESOLVER_NOT_CONFIGURED'
        if (playbackMode === 'cloud-only' && !resolverWasRemoved) return 'worker-error'
        // Combined mode is also an availability fallback: continue through the linked device when
        // the user's Worker is temporarily unavailable.
      }
    }

    if (viewer !== tvProfileId() || !tvProfileReady()) return 'no-source'
    return this.requestFromDevice(media, requestId, secureRequestId)
  }

  /** Warm a Worker-resolved source without waking the paired device or interrupting playback. */
  async prefetchPlay(media: CompanionMedia): Promise<boolean> {
    if (!tvProfileReady() || !tvAllowsMedia(media)) return false
    if (!this.credential || !this.cloudflare || this.cloudflare.playbackMode === 'device-only') return false
    const key = this.playKey(media)
    const cached = this.prefetchedPlays.get(key)
    if (cached && cached.expiresAt > Date.now()) return true
    const requestId = secureRandomHex(16) ?? randomHex(16)
    try {
      const result = await workerRequest(
        this.cloudflare,
        `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/resolve`,
        'POST',
        cloudResolveRequest(media),
        30_000,
      )
      const selection = cloudResolveSelection(result, media, requestId)
      if (!selection) return false
      this.prefetchedPlays.set(key, {
        expiresAt: Date.now() + 5 * 60_000,
        result: { kind: 'resolved', ...selection },
      })
      return true
    } catch {
      return false
    }
  }

  private playKey(media: CompanionMedia): string {
    return `${tvProfileId()}:${media.ref.provider}:${media.ref.type}:${media.ref.id}:${media.season ?? ''}:${media.episode ?? ''}`
  }

  canRequestDeviceSourceChange(): boolean {
    return Boolean(this.credential) && (this.cloudflare?.playbackMode ?? 'device-only') !== 'cloud-only'
  }

  /** Ask the linked client for an explicit replacement while the current TV source keeps playing. */
  requestDeviceSourceChange(media: CompanionMedia, positionSeconds: number): Promise<CompanionPlayResult> {
    if (!this.canRequestDeviceSourceChange()) return Promise.resolve('no-source')
    const secureRequestId = secureRandomHex(16)
    const requestId = secureRequestId ?? randomHex(16)
    this.deviceSourceRequests.set(requestId, Date.now() + REMOTE_REQUEST_TTL_MS)
    return this.requestFromDevice({
      ...media,
      playback: {
        selection: 'manual',
        positionSeconds: Math.max(0, Math.min(Number(positionSeconds) || 0, 604_800)),
      },
    }, requestId, secureRequestId)
  }

  private async requestFromDevice(
    media: CompanionMedia,
    requestId: string,
    secureRequestId: string | null,
  ): Promise<CompanionPlayResult> {
    const viewer = tvProfileId()
    if (!tvProfileReady() || !tvAllowsMedia(media)) return 'no-source'
    const pairingId = this.cloudflare?.pairingId ?? this.credential.slice(0, 16)
    const accepted = new Promise<boolean>((resolve) => {
      const finish = (value: boolean) => {
        window.clearTimeout(timer)
        this.playAcknowledgements.delete(requestId)
        resolve(value)
      }
      const timer = window.setTimeout(() => finish(false), LOCAL_PLAY_ACK_MS)
      this.playAcknowledgements.set(requestId, finish)
    })
    this.publish('izumi.companion.play', {
      ref: media.ref,
      episode: media.episode,
      season: media.season,
      resolver: media.resolver,
      playback: media.playback,
      resumePositionSeconds: media.resumePositionSeconds,
      pairingId,
      requestId,
    }, 'broadcast')
    if (await accepted) return 'local'
    if (viewer !== tvProfileId() || !tvProfileReady()) return 'no-source'
    if (!this.cloudflare) return 'open-client'
    if (!this.cloudflare.wakeWhenClosed) return 'open-client'
    if (!secureRequestId || !crypto.subtle) return 'open-client'
    try {
      const payload = await encryptedPlayRequest(this.credential, pairingId, requestId, media)
      const result = await workerRequest(
        this.cloudflare,
        `/v1/companion/pairings/${encodeURIComponent(pairingId)}/requests/${encodeURIComponent(requestId)}`,
        'POST',
        { requestId, payload },
      )
      return Number(result.notified || 0) > 0 ? 'notified' : 'queued'
    } catch {
      return 'worker-error'
    }
  }

  requestCatalog(screen: string): boolean {
    const viewer = tvProfileId()
    if (!tvProfileReady()) { void this.refreshCloudSnapshot(); return false }
    if (!this.credential || !screen || screen.length > 40) return false
    if (this.cloudflare) {
      void (async () => {
        if (await this.refreshCloudSnapshot(screen)) return
        if (viewer !== tvProfileId() || !tvProfileReady()) return
        try {
          const result = await workerRequest(
            this.cloudflare!,
            `/v1/companion/pairings/${encodeURIComponent(this.cloudflare!.pairingId)}/catalog`,
            'POST', { screen }, 20_000,
          )
          if (isCompanionSnapshot(result.snapshot)) {
            updateTvHousehold(result.snapshot.household)
            if (viewer !== tvProfileId() || !snapshotMatchesTvProfile(result.snapshot)) return
            const snapshot = await this.withCloudProgress(result.snapshot)
            if (viewer === tvProfileId()) this.acceptSnapshot(snapshot)
            return
          }
        } catch (error) {
          if (viewer !== tvProfileId() || !tvProfileReady()) return
          if (!this.connected) {
            this.events.onCatalogError?.(screen, error instanceof Error ? error.message : 'The cloud catalogue is unavailable.')
            return
          }
        }
        this.publish('izumi.companion.catalog', { screen, pairingId: this.credential.slice(0, 16) }, 'broadcast')
      })()
      return true
    }
    if (!this.connected) return false
    this.publish('izumi.companion.catalog', { screen, pairingId: this.credential.slice(0, 16) }, 'broadcast')
    return true
  }

  requestSearch(query: string, person?: CompanionPersonFilter, genre?: string): boolean {
    const viewer = tvProfileId()
    if (!tvProfileReady()) return false
    const normalized = query.trim().slice(0, 80)
    if (!this.credential || !normalized) return false
    const askLinked = () => this.publish('izumi.companion.search', {
      query: normalized, person, genre, requestId: randomHex(12), pairingId: this.credential.slice(0, 16),
    }, 'broadcast')
    if (this.cloudflare) {
      const screen = storedSnapshot()?.catalog.screen ?? 'auto'
      void workerRequest(
        this.cloudflare,
        `/v1/companion/pairings/${encodeURIComponent(this.cloudflare.pairingId)}/search`,
        'POST', { screen, query: normalized, person, genre }, 20_000,
      ).then((result) => {
        const items = (Array.isArray(result.items) ? result.items : []).slice(0, 40).filter(validCompanionMedia).filter(tvAllowsMedia)
        this.events.onSearchResults(normalized, items, undefined, person, genre)
      }).catch((error) => {
        if (viewer !== tvProfileId() || !tvProfileReady()) return
        if (this.connected) askLinked()
        else this.events.onSearchResults(normalized, [], error instanceof Error ? error.message : 'Cloud search is unavailable.', person, genre)
      })
      return true
    }
    if (!this.connected) return false
    askLinked()
    return true
  }

  selectDeviceSource(requestId: string, choiceId: string): boolean {
    const expiresAt = this.deviceSourceRequests.get(requestId)
    if (!this.credential || !this.connected || !expiresAt || expiresAt <= Date.now()
      || !/^[A-Za-z0-9_-]{1,80}$/.test(choiceId)) return false
    this.publish('izumi.companion.source-select', {
      pairingId: this.cloudflare?.pairingId ?? this.credential.slice(0, 16),
      requestId,
      choiceId,
    }, 'broadcast')
    return true
  }

  private messageSender(value: unknown, from: unknown): string {
    const direct = peerId(from)
    if (direct) return direct
    const message = parseMessage(value)
    if (!message || typeof message !== 'object') return ''
    const senderId = (message as Record<string, unknown>).senderId
    return typeof senderId === 'string' && senderId.length > 0 && senderId.length <= 128 ? senderId : ''
  }

  beginPlayback(request: CastLoadRequest): void {
    this.activePlayback = request.media ? { sessionId: request.sessionId, media: request.media, profileId: tvProfileId() } : undefined
    this.localProgressAt = 0
    if (request.sessionId.startsWith('cloud-') && request.media && this.cloudflare) {
      this.cloudPlayback = { sessionId: request.sessionId, media: request.media, profileId: tvProfileId() }
      this.activeSessionId = request.sessionId
      this.cloudProgressAt = 0
    } else if (!request.sessionId.startsWith('cloud-')) {
      this.cloudPlayback = undefined
    }
  }

  private async writeCloudProgress(snapshot: PlaybackSnapshot): Promise<void> {
    const active = this.cloudPlayback
    const transport = this.cloudflare
    if (!active || !transport || active.sessionId !== snapshot.sessionId || !crypto.subtle) return
    const mediaKey = await progressKey(active.media, active.profileId)
    const positionSeconds = Math.max(0, Math.min(604_800, Number(snapshot.positionSeconds) || 0))
    const durationSeconds = Math.max(0, Math.min(604_800, Number(snapshot.durationSeconds) || 0))
    const completed = durationSeconds > 0 && positionSeconds / durationSeconds >= 0.85
    const value = {
      profileId: active.profileId,
      media: active.media,
      sessionId: snapshot.sessionId,
      positionSeconds,
      durationSeconds,
      state: snapshot.state,
      completed,
      updatedAt: Date.now(),
    }
    const payload = await encryptTvPayload(transport, `progress:${mediaKey}`, value)
    await workerRequest(
      transport,
      `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}/progress`,
      'PUT', { mediaKey, payload }, 8_000,
    )
  }

  publishStatus(snapshot: PlaybackSnapshot): void {
    const now = Date.now()
    const finalState = snapshot.state === 'paused' || snapshot.state === 'idle' || Boolean(snapshot.error)
    if (this.activePlayback?.profileId === tvProfileId() && this.activePlayback?.sessionId === snapshot.sessionId
      && (this.localProgressAt === 0 || now - this.localProgressAt >= 5_000
        || finalState && now - this.localProgressAt >= 1_000)) {
      this.localProgressAt = now
      const record = savePlaybackProgress(this.activePlayback.media, snapshot, now)
      if (this.progressSubscriberId) {
        this.publish('izumi.companion.progress-result', {
          credential: this.credential,
          records: [record],
        }, this.progressSubscriberId)
      }
      const stored = storedSnapshot()
      if (stored) {
        const merged = mergePlaybackProgress(stored)
        storeSnapshot(merged)
        this.events.onPlaybackProgress?.(merged)
      }
    }
    if (this.activeSenderId && snapshot.sessionId === this.activeSessionId) {
      this.publish('izumi.status', snapshot, this.activeSenderId)
    }
    if (!this.cloudPlayback || snapshot.sessionId !== this.cloudPlayback.sessionId) return
    if (!snapshot.forced && now - this.cloudProgressAt < 15_000) {
      this.pendingCloudProgress = snapshot
      return
    }
    this.cloudProgressAt = now
    if (this.cloudProgressWriting) {
      this.pendingCloudProgress = snapshot
      return
    }
    this.cloudProgressWriting = true
    void this.writeCloudProgress(snapshot).catch(() => {}).finally(() => {
      this.cloudProgressWriting = false
      const pending = this.pendingCloudProgress
      this.pendingCloudProgress = undefined
      if (pending?.forced) this.publishStatus(pending)
    })
  }

  clearPlayback(): void {
    this.activeSenderId = ''
    this.activeSessionId = ''
    this.activePlayback = undefined
    this.cloudPlayback = undefined
    this.pendingCloudProgress = undefined
  }

  unpair(revokeWorker = true): void {
    const personalKeys: string[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key && /^izumi\.companion\.(snapshot|playback-progress)(:|$)/.test(key)) personalKeys.push(key)
    }
    personalKeys.forEach((key) => localStorage.removeItem(key))
    if (revokeWorker) void this.revokeCloudflarePairing()
    localStorage.removeItem('izumi.companion.credential')
    localStorage.removeItem('izumi.companion.cloudflare')
    localStorage.removeItem(tvProfileStorageKey(SNAPSHOT_STORAGE_KEY))
    clearPlaybackProgress()
    resetTvHousehold()
    this.credential = ''
    this.progressSubscriberId = ''
    this.deviceSourceRequests.clear()
    this.clearTrailerRequests()
    this.cloudflare = null
    this.clearPlayback()
    this.pairing = this.createPairingInfo()
    this.events.onPairingInfo(this.pairing)
    this.events.onPaired(false)
    this.events.onDeviceSourceAvailability?.(false)
    this.publish('izumi.companion.unpaired', { deviceId: this.pairing.deviceId }, 'broadcast')
    this.sendChallenge('broadcast')
  }

  resetClient(): void {
    void this.revokeCloudflarePairing()
    Object.keys(localStorage)
      .filter((key) => key.startsWith('izumi.companion.'))
      .forEach((key) => localStorage.removeItem(key))
    resetTvHousehold()
    this.credential = ''
    this.cloudflare = null
    this.clearTrailerRequests()
    this.clearPlayback()
    this.pairing = this.createPairingInfo()
    this.events.onPairingInfo(this.pairing)
    this.events.onPaired(false)
    this.events.onDeviceSourceAvailability?.(false)
    this.sendChallenge('broadcast')
  }

  disconnect(): void {
    if (this.pairingTimer) window.clearInterval(this.pairingTimer)
    try { this.channel?.disconnect() } catch { /* disconnected already */ }
    this.channel = undefined
    this.connected = false
    this.clearTrailerRequests()
    this.events.onConnection(false)
  }

  private clearTrailerRequests(): void {
    for (const finish of [...this.trailerRequests.values()]) finish(null, 'The paired device disconnected while preparing the trailer.')
    this.trailerRequests.clear()
  }

  private createPairingInfo(): PairingInfo {
    const stored = localStorage.getItem('izumi.companion.device')
    const deviceId = stored && /^[0-9a-f]{24}$/i.test(stored) ? stored : randomHex(12)
    localStorage.setItem('izumi.companion.device', deviceId)
    const challenge = randomHex(16)
    const expiresAt = Date.now() + PAIRING_LIFETIME_MS
    const address = privateAddress()
    const query = new URLSearchParams({ v: '1', tv: address, device: deviceId, challenge })
    return { deviceId, challenge, expiresAt, address, link: `izumi://companion/pair?${query}` }
  }

  private sendChallenge(target: string): void {
    if (Date.now() >= this.pairing.expiresAt) {
      this.pairing = this.createPairingInfo()
      this.events.onPairingInfo(this.pairing)
    }
    this.publish('izumi.companion.challenge', {
      deviceId: this.pairing.deviceId,
      challenge: this.pairing.challenge,
      expiresAt: this.pairing.expiresAt,
    }, target || 'broadcast')
  }

  private receivePair(value: unknown, senderId: string): void {
    const message = parseMessage(value)
    if (!message || typeof message !== 'object' || !senderId) return
    const input = message as Record<string, unknown>
    const accepted = input.protocol === 1
      && input.challenge === this.pairing.challenge
      && Date.now() < this.pairing.expiresAt
      && typeof input.credential === 'string'
      && /^[0-9a-f]{64}$/i.test(input.credential)
    if (!accepted) {
      this.publish('izumi.companion.paired', { ok: false, deviceId: this.pairing.deviceId, error: 'Pairing challenge rejected.' }, senderId)
      return
    }
    // Re-pairing replaces and revokes the previous private route; a TV never fans out through an
    // old Worker after its owner has linked a different Android device.
    if (this.cloudflare) void this.revokeCloudflarePairing()
    if (this.credential && this.credential !== input.credential) clearPlaybackProgress()
    this.credential = String(input.credential)
    localStorage.setItem('izumi.companion.credential', this.credential)
    const transport = input.transport && typeof input.transport === 'object'
      ? parseCloudflareTransport((input.transport as Record<string, unknown>).cloudflare)
      : null
    this.cloudflare = transport
    this.events.onDeviceSourceAvailability?.(this.canRequestDeviceSourceChange())
    if (transport) localStorage.setItem('izumi.companion.cloudflare', JSON.stringify(transport))
    else localStorage.removeItem('izumi.companion.cloudflare')
    this.events.onPaired(true)
    const snapshot = input.snapshot
    if (isCompanionSnapshot(snapshot)) {
      this.acceptSnapshot(snapshot)
    } else localStorage.removeItem(tvProfileStorageKey(SNAPSHOT_STORAGE_KEY))
    this.publish('izumi.companion.paired', { ok: true, deviceId: this.pairing.deviceId }, senderId)
  }

  private receiveSnapshot(value: unknown): void {
    const message = parseMessage(value)
    if (!message || typeof message !== 'object') return
    const input = message as { credential?: unknown; snapshot?: unknown }
    if (!this.credential || input.credential !== this.credential || !isCompanionSnapshot(input.snapshot)) return
    this.events.onPaired(true)
    this.acceptSnapshot(input.snapshot)
  }

  private acceptSnapshot(snapshot: CompanionHomeSnapshot): boolean {
    updateTvHousehold(snapshot.household)
    if (!tvProfileReady() || !snapshotMatchesTvProfile(snapshot)) return false
    const safe = filterTvSnapshot(mergePlaybackProgress(snapshot))
    const choices = readDiscoveryChoices()
    for (const decision of safe.discovery?.decisions ?? []) {
      const local = choices[decision.key]
      if (local?.pending && local.at === decision.at && local.action === decision.action) persistDiscoveryChoice({ ...local, pending: false })
    }
    storeSnapshot(safe)
    this.events.onSnapshot(safe)
    return true
  }

  refreshForProfile(): void {
    this.prefetchedPlays.clear()
    this.deviceSourceRequests.clear()
    for (const finish of this.detailRequests.values()) finish(null)
    const snapshot = storedSnapshot()
    if (snapshot) this.acceptSnapshot(snapshot)
    else this.events.onSnapshot({ app: 'izumi', kind: 'companion-home', version: 1, revision: 'profile-' + Date.now(), generatedAt: Date.now(), profileId: tvProfileId(), household: tvHousehold(), catalog: { screen: 'auto', label: 'Home' }, rows: [], history: [] })
    this.requestCatalog(snapshot?.catalog.screen ?? 'auto')
  }

  private publish(event: string, data: unknown, target: string): void {
    if (!this.channel || !this.connected && event !== 'izumi.ready') return
    if (tvHousehold().enabled && event.startsWith('izumi.companion.') && data && typeof data === 'object') data = { ...data, profileId: tvProfileId() }
    try { this.channel.publish(event, data, target || 'broadcast') } catch { /* receiver may be closing */ }
  }

  private async revokeCloudflarePairing(): Promise<void> {
    const transport = this.cloudflare
    if (!transport) return
    try {
      await workerRequest(transport, `/v1/companion/pairings/${encodeURIComponent(transport.pairingId)}`, 'DELETE')
    } catch { /* Private Worker may be offline; its short-lived requests still expire. */ }
  }
}
