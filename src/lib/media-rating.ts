import type { CompanionMedia } from '../types'

export type MediaRating = 'up' | 'down'

const STORAGE_KEY = 'izumi.companion.media-ratings'
const MAX_RATINGS = 250

export interface StoredMediaRating {
  value: MediaRating
  updatedAt: number
}

export type MediaRatings = Record<string, StoredMediaRating>

export function mediaRatingKey(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

export function readMediaRatings(): MediaRatings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Record<string, unknown> | null
    if (!stored || typeof stored !== 'object') return {}
    const ratings: MediaRatings = {}
    Object.keys(stored).slice(0, MAX_RATINGS).forEach((key) => {
      const entry = stored[key]
      if (!entry || typeof entry !== 'object') return
      const value = (entry as Partial<StoredMediaRating>).value
      const updatedAt = Number((entry as Partial<StoredMediaRating>).updatedAt)
      if ((value === 'up' || value === 'down') && Number.isFinite(updatedAt)) ratings[key] = { value, updatedAt }
    })
    return ratings
  } catch {
    return {}
  }
}

export function writeMediaRating(
  ratings: MediaRatings,
  media: CompanionMedia,
  value: MediaRating,
  now = Date.now(),
): MediaRatings {
  const key = mediaRatingKey(media)
  const next = { ...ratings }
  if (next[key]?.value === value) delete next[key]
  else next[key] = { value, updatedAt: now }
  const ordered = Object.keys(next).sort((left, right) => next[right].updatedAt - next[left].updatedAt)
  const limited: MediaRatings = {}
  ordered.slice(0, MAX_RATINGS).forEach((entryKey) => { limited[entryKey] = next[entryKey] })
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(limited)) } catch { /* TV storage is best-effort. */ }
  return limited
}
