import type { CompanionHomeSnapshot, CompanionMedia } from '../types'

export interface TvProfile {
  id: string
  name: string
  color: string
  avatar?: string
  createdAt: number
  updatedAt?: number
  ratingLimit: number
  allowAdult: boolean
  pin?: { salt: string; hash: string }
}
export interface TvHousehold { enabled?: boolean; modeUpdatedAt?: number; profiles: TvProfile[] }
const HOUSEHOLD_KEY = 'izumi.companion.household'
const ACTIVE_KEY = 'izumi.companion.profile'
export const PROFILES_CHANGED = 'izumi-profiles-changed'
function stored(key: string) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
}
function normalized(value: unknown): TvHousehold {
  const raw = value as Partial<TvHousehold> | null
  const profiles = (Array.isArray(raw?.profiles) ? raw.profiles : []).filter((item) =>
    item && /^[A-Za-z0-9_-]{1,100}$/.test(item.id) && typeof item.name === 'string'
    && [7, 12, 16, 18].includes(item.ratingLimit)).slice(0, 8)
  return { enabled: raw?.enabled === true, modeUpdatedAt: raw?.modeUpdatedAt ?? 0, profiles }
}
let household = normalized(stored(HOUSEHOLD_KEY))
let selected = typeof stored(ACTIVE_KEY) === 'string' ? stored(ACTIVE_KEY) as string : 'default'
let unlocked = ''
let pinInMemory = ''
let attempts = 0
let retryAt = 0
const identity = (profile: TvProfile) => profile.id + ':' + (profile.pin?.hash ?? 'open')
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROFILES_CHANGED)) }
export const tvHousehold = () => household
export const tvProfileId = () => household.enabled ? selected : 'default'
export const tvProfile = () => household.profiles.find((profile) => profile.id === tvProfileId())
export const tvProfileReady = () => !household.enabled || Boolean(tvProfile() && unlocked === identity(tvProfile()!))
export const tvProfileScope = () => ({ profileId: tvProfileId(), ...(pinInMemory ? { profilePin: pinInMemory } : {}) })
export const tvProfileStorageKey = (base: string) => tvProfileId() === 'default' ? base : base + ':' + tvProfileId()
export function resetTvHousehold() { household = { enabled: false, profiles: [] }; selected = 'default'; unlocked = ''; pinInMemory = ''; localStorage.removeItem(HOUSEHOLD_KEY); localStorage.removeItem(ACTIVE_KEY); notify() }
export function lockTvProfiles() { unlocked = ''; pinInMemory = ''; notify() }
export function updateTvHousehold(value: unknown): void {
  if (!value) return // An older sender cannot silently remove an installed household gate.
  const next = normalized(value)
  if (next.enabled && !next.profiles.length) return
  const revision = (state: TvHousehold) => Math.max(state.modeUpdatedAt ?? 0, ...state.profiles.map((profile) => profile.updatedAt ?? profile.createdAt ?? 0))
  if (revision(next) < revision(household)) return
  if (JSON.stringify(next) === JSON.stringify(household)) return
  household = next
  if (!next.profiles.some((profile) => profile.id === selected)) selected = 'default'
  if (!tvProfileReady()) { unlocked = ''; pinInMemory = '' }
  try { localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(next)) } catch { /* limited TV storage */ }
  notify()
}
export async function chooseTvProfile(id: string, pin = ''): Promise<boolean> {
  if (Date.now() < retryAt) throw new Error('Too many attempts. Try again in a minute.')
  const profile = household.profiles.find((profile) => profile.id === id)
  if (!profile) return false
  if (profile.pin) {
    if (!/^\d{4,6}$/.test(pin)) return false
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(profile.pin.salt + ':' + pin)))
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== profile.pin.hash) {
      attempts += 1
      if (attempts >= 5) { retryAt = Date.now() + 60_000; attempts = 0 }
      return false
    }
  }
  selected = id; unlocked = identity(profile); pinInMemory = profile.pin ? pin : ''; attempts = 0
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(id)) } catch { /* selection still works in memory */ }
  notify()
  return true
}
export function tvAllowsMedia(media: Pick<CompanionMedia, 'contentRating' | 'isAdult'>): boolean {
  if (!household.enabled) return true
  const profile = tvProfile()
  if (!profile) return false
  if (media.isAdult && !profile.allowAdult) return false
  const rating = media.contentRating ?? ''
  const patterns: Array<[RegExp, number]> = [[/\b(?:nc-?17|tv-ma|18\+?|r18|rx|adult)\b/i, 18], [/\b(?:r\+?|tv-?17|17\+?|16\+?|16)\b/i, 16], [/\b(?:pg-?13|tv-14|15|14\+?|12a?)\b/i, 12], [/\b(?:pg|tv-pg|tv-y7|7\+?)\b/i, 7]]
  const age = patterns.find(([pattern]) => pattern.test(rating))?.[1]
  return age == null || age <= profile.ratingLimit
}
export function snapshotMatchesTvProfile(snapshot: CompanionHomeSnapshot): boolean {
  return (snapshot.profileId ?? 'default') === tvProfileId()
}
export function filterTvSnapshot(snapshot: CompanionHomeSnapshot): CompanionHomeSnapshot {
  const rows = snapshot.rows.map((row) => ({ ...row, items: row.items.filter(tvAllowsMedia) })).filter((row) => row.items.length)
  return { ...snapshot, rows, discovery: snapshot.discovery ? { ...snapshot.discovery, candidates: snapshot.discovery.candidates.filter(tvAllowsMedia) } : undefined, hero: snapshot.hero && tvAllowsMedia(snapshot.hero) ? snapshot.hero : rows[0]?.items[0], history: snapshot.history?.filter(tvAllowsMedia),
    views: snapshot.views ? Object.fromEntries(Object.entries(snapshot.views).map(([key, items]) => [key, items?.filter(tvAllowsMedia)])) : undefined }
}
