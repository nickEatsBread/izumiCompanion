import type { CompanionEpisode, CompanionHomeSnapshot, CompanionMedia, PlaybackSnapshot } from '../types'
import { tvProfileId, tvProfileStorageKey } from './profiles'

const STORAGE_KEY = 'izumi.companion.playback-progress'
const MAX_RECORDS = 24
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1_000

export interface StoredPlaybackProgress {
  profileId?: string
  recordKey: string
  media: CompanionMedia
  positionSeconds: number
  durationSeconds: number
  completed: boolean
  updatedAt: number
}

export function playbackMediaKey(media: Pick<CompanionMedia, 'ref'>): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

function compactMedia(media: CompanionMedia): CompanionMedia {
  const {
    cast: _cast,
    crew: _crew,
    episodes: _episodes,
    recommendations: _recommendations,
    relations: _relations,
    playback: _playback,
    ...compact
  } = media
  return compact
}

function validRecord(value: unknown, now: number): value is StoredPlaybackProgress {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<StoredPlaybackProgress>
  const media = record.media
  return typeof record.recordKey === 'string'
    && record.recordKey.length > 0
    && record.recordKey.length <= 480
    && Boolean(media && typeof media === 'object')
    && typeof media?.title === 'string'
    && Boolean(media.ref)
    && typeof media.ref.provider === 'string'
    && typeof media.ref.type === 'string'
    && typeof media.ref.id === 'string'
    && typeof record.positionSeconds === 'number'
    && Number.isFinite(record.positionSeconds)
    && record.positionSeconds >= 0
    && typeof record.durationSeconds === 'number'
    && Number.isFinite(record.durationSeconds)
    && record.durationSeconds >= 0
    && typeof record.updatedAt === 'number'
    && Number.isFinite(record.updatedAt)
    && record.updatedAt > now - MAX_AGE_MS
    && record.updatedAt <= now + 60_000
}

function normalizeRecords(value: unknown, now = Date.now()): StoredPlaybackProgress[] {
  const records = (Array.isArray(value) ? value : [])
    .filter((record): record is StoredPlaybackProgress => validRecord(record, now))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const seen = new Set<string>()
  return records.filter((record) => {
    if (seen.has(record.recordKey)) return false
    seen.add(record.recordKey)
    return true
  }).slice(0, MAX_RECORDS)
}

export function readPlaybackProgress(now = Date.now()): StoredPlaybackProgress[] {
  try {
    return normalizeRecords(JSON.parse(localStorage.getItem(tvProfileStorageKey(STORAGE_KEY)) || '[]'), now)
  } catch {
    return []
  }
}

function writePlaybackProgress(records: StoredPlaybackProgress[]): void {
  try { localStorage.setItem(tvProfileStorageKey(STORAGE_KEY), JSON.stringify(records)) } catch { /* Best-effort TV storage. */ }
}

export function savePlaybackProgress(
  media: CompanionMedia,
  snapshot: PlaybackSnapshot,
  now = Date.now(),
): StoredPlaybackProgress {
  const positionSeconds = Math.max(0, Math.min(604_800, Number(snapshot.positionSeconds) || 0))
  const durationSeconds = Math.max(0, Math.min(604_800, Number(snapshot.durationSeconds) || 0))
  const completed = durationSeconds > 0 && positionSeconds / durationSeconds >= 0.85
  const recordKey = [
    playbackMediaKey(media),
    Number.isFinite(media.season) ? media.season : '',
    Number.isFinite(media.episode) ? media.episode : '',
  ].join(':')
  const record: StoredPlaybackProgress = {
    profileId: tvProfileId(),
    recordKey,
    media: compactMedia(media),
    positionSeconds,
    durationSeconds,
    completed,
    updatedAt: now,
  }
  writePlaybackProgress(normalizeRecords([
    record,
    ...readPlaybackProgress(now).filter((candidate) => candidate.recordKey !== recordKey),
  ], now))
  return record
}

export function clearPlaybackProgress(): void {
  localStorage.removeItem(tvProfileStorageKey(STORAGE_KEY))
}

function progressMedia(record: StoredPlaybackProgress, base?: CompanionMedia): CompanionMedia {
  const fraction = record.durationSeconds > 0
    ? Math.max(0, Math.min(1, record.positionSeconds / record.durationSeconds))
    : base?.episodeProgress
  return {
    ...record.media,
    ...base,
    season: record.media.season ?? base?.season,
    episode: record.media.episode ?? base?.episode,
    episodeProgress: record.completed ? 1 : fraction,
    episodeRuntimeMinutes: record.durationSeconds > 0
      ? record.durationSeconds / 60
      : record.media.episodeRuntimeMinutes ?? base?.episodeRuntimeMinutes,
    resumePositionSeconds: record.completed ? undefined : record.positionSeconds,
    placement: base?.placement ?? { label: 'Continue Watching', kind: 'continue' },
  }
}

/** Keep all episode checkpoints, including earlier seasons, when provider details are refreshed. */
export function mergeEpisodeProgress(media: CompanionMedia, records: StoredPlaybackProgress[]): CompanionMedia {
  const matching = records.filter((record) => playbackMediaKey(record.media) === playbackMediaKey(media)
    && (record.profileId ?? 'default') === tvProfileId() && record.media.episode != null)
    .sort((left, right) => left.updatedAt - right.updatedAt)
  if (!matching.length) return media
  const episodes = new Map<string, CompanionEpisode>((media.episodes ?? []).map((item) => [`${item.season}:${item.episode}`, item]))
  for (const record of matching) {
    const season = record.media.season ?? 1
    const episode = record.media.episode!
    const key = `${season}:${episode}`
    const previous = episodes.get(key)
    episodes.set(key, {
      ...previous,
      season,
      episode,
      runtimeMinutes: record.durationSeconds > 0 ? record.durationSeconds / 60 : previous?.runtimeMinutes,
      progress: record.completed ? 1 : record.durationSeconds > 0
        ? Math.min(1, record.positionSeconds / record.durationSeconds) : previous?.progress,
      watched: record.completed,
    })
  }
  return { ...media, episodes: [...episodes.values()] }
}

/** Catalog/search cards may have no watch state. Hydrate them before opening series details. */
export function mediaWithPlaybackProgress(
  media: CompanionMedia,
  snapshot: CompanionHomeSnapshot,
  records = readPlaybackProgress(),
): CompanionMedia {
  const key = playbackMediaKey(media)
  const linked = [...snapshot.rows.filter((row) => row.kind === 'continue').flatMap((row) => row.items), ...(snapshot.history ?? [])]
    .find((item) => playbackMediaKey(item) === key)
  const episodes = new Map((media.episodes ?? []).map((item) => [`${item.season}:${item.episode}`, item]))
  for (const item of linked?.episodes ?? []) {
    const episodeKey = `${item.season}:${item.episode}`
    episodes.set(episodeKey, { ...item, ...episodes.get(episodeKey), progress: item.progress, watched: item.watched })
  }
  let result = linked ? {
    ...media,
    progress: linked.progress ?? media.progress,
    season: linked.season ?? media.season,
    episode: linked.episode ?? media.episode,
    episodeProgress: linked.episodeProgress,
    resumePositionSeconds: linked.resumePositionSeconds,
    episodeRuntimeMinutes: linked.episodeRuntimeMinutes ?? media.episodeRuntimeMinutes,
    episodes: [...episodes.values()],
  } : media
  const latest = records.filter((record) => playbackMediaKey(record.media) === key
    && (record.profileId ?? 'default') === tvProfileId()).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  // A linked client may already have advanced to the next episode. Keep that target intact.
  if (latest && (!linked || ((linked.season ?? 1) === (latest.media.season ?? 1) && linked.episode === latest.media.episode))) {
    result = progressMedia(latest, result)
  }
  return mergeEpisodeProgress(result, records)
}

/** Merge crash-safe TV checkpoints into any catalogue snapshot. Incomplete records that are not
 * present in the linked device's snapshot are inserted into Continue Watching and Watch History. */
export function mergePlaybackProgress(
  snapshot: CompanionHomeSnapshot,
  records = readPlaybackProgress(),
): CompanionHomeSnapshot {
  records = records.filter((record) => (record.profileId ?? 'default') === (snapshot.profileId ?? 'default'))
  if (!records.length) return snapshot
  const latest = new Map<string, StoredPlaybackProgress>()
  for (const record of records) {
    const key = playbackMediaKey(record.media)
    if (!latest.has(key) || latest.get(key)!.updatedAt < record.updatedAt) latest.set(key, record)
  }
  const recordFor = (media: CompanionMedia): StoredPlaybackProgress | undefined => {
    const record = latest.get(playbackMediaKey(media))
    if (!record) return undefined
    if (media.episode != null && record.media.episode != null && media.episode !== record.media.episode) return undefined
    if (media.season != null && record.media.season != null && media.season !== record.media.season) return undefined
    return record
  }
  const merge = (media: CompanionMedia): CompanionMedia => {
    const record = recordFor(media)
    return mergeEpisodeProgress(record ? progressMedia(record, media) : media, records)
  }
  const rows = snapshot.rows.map((row) => ({
    ...row,
    items: row.kind === 'continue'
      ? row.items.filter((media) => !recordFor(media)?.completed).map(merge)
      : row.items.map(merge),
  })).filter((row) => row.kind !== 'continue' || row.items.length > 0)
  let continueRow = rows.find((row) => row.kind === 'continue')
  const incomplete = [...latest.values()].filter((record) => !record.completed && record.positionSeconds > 0)
  if (incomplete.length) {
    if (!continueRow) {
      continueRow = { id: 'continue', title: 'Continue Watching', kind: 'continue', items: [] }
      rows.unshift(continueRow)
    }
    const existing = new Set(continueRow.items.map(playbackMediaKey))
    const recovered = incomplete
      .filter((record) => !existing.has(playbackMediaKey(record.media)))
      .map((record) => mergeEpisodeProgress(progressMedia(record), records))
    continueRow.items = [...recovered, ...continueRow.items]
  }
  const history = (snapshot.history ?? []).map(merge)
  const historyKeys = new Set(history.map(playbackMediaKey))
  const recoveredHistory = [...latest.values()]
    .filter((record) => !historyKeys.has(playbackMediaKey(record.media)))
    .map((record) => mergeEpisodeProgress(progressMedia(record), records))
  return {
    ...snapshot,
    hero: snapshot.hero ? merge(snapshot.hero) : undefined,
    rows,
    history: [...recoveredHistory, ...history],
    views: snapshot.views ? Object.fromEntries(
      Object.entries(snapshot.views).map(([key, values]) => [key, values?.map(merge)]),
    ) as CompanionHomeSnapshot['views'] : undefined,
  }
}
