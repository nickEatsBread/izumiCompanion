import type { CompanionHomeSnapshot, CompanionMedia, PlaybackSnapshot } from '../types'

const STORAGE_KEY = 'izumi.companion.playback-progress'
const MAX_RECORDS = 24
const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1_000

export interface StoredPlaybackProgress {
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
    return normalizeRecords(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'), now)
  } catch {
    return []
  }
}

function writePlaybackProgress(records: StoredPlaybackProgress[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)) } catch { /* Best-effort TV storage. */ }
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
  localStorage.removeItem(STORAGE_KEY)
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

/** Merge crash-safe TV checkpoints into any catalogue snapshot. Incomplete records that are not
 * present in the linked device's snapshot are inserted into Continue Watching and Watch History. */
export function mergePlaybackProgress(
  snapshot: CompanionHomeSnapshot,
  records = readPlaybackProgress(),
): CompanionHomeSnapshot {
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
    return record ? progressMedia(record, media) : media
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
      .map((record) => progressMedia(record))
    continueRow.items = [...recovered, ...continueRow.items]
  }
  const history = (snapshot.history ?? []).map(merge)
  const historyKeys = new Set(history.map(playbackMediaKey))
  const recoveredHistory = [...latest.values()]
    .filter((record) => !historyKeys.has(playbackMediaKey(record.media)))
    .map((record) => progressMedia(record))
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
