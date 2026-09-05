import type { CompanionMedia, CompanionHomeSnapshot } from '../types'
import { tvProfileId, tvProfileStorageKey, tvAllowsMedia } from './profiles'
export const DISCOVERY_REMOTE = 'izumi-discovery-remote'
export const DISCOVERY_CHANGED = 'izumi-discovery-changed'
export interface DiscoveryChoice {
  profileId: string
  media: CompanionMedia
  action: 'save' | 'skip' | 'dismiss' | 'undo'
  at: number
  pending?: boolean
}
export const discoveryKey = (media: CompanionMedia) => `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
export function readDiscoveryChoices(): Record<string, DiscoveryChoice> {
  try {
    const value = JSON.parse(localStorage.getItem(tvProfileStorageKey('izumi.discovery.v2')) ?? '{}')
    return Object.fromEntries(Object.entries(value).filter(([, item]) => validDiscoveryChoice(item)).slice(0, 500)) as Record<string, DiscoveryChoice>
  } catch { return {} }
}
export function validDiscoveryChoice(value: unknown): value is DiscoveryChoice {
  if (!value || typeof value !== 'object') return false
  const item = value as DiscoveryChoice
  return item.profileId === tvProfileId() && !!item.media?.ref && typeof item.media.title === 'string'
    && typeof item.media.ref.id === 'string' && typeof item.media.ref.provider === 'string' && typeof item.media.ref.type === 'string'
    && ['save', 'skip', 'dismiss', 'undo'].includes(item.action) && Number.isFinite(item.at) && item.at > 0 && item.at <= Date.now() + 60_000
}
/** Feedback needs identity and presentation, never episode trees, streams or credentials. */
export function discoveryChoiceMedia(media: CompanionMedia): CompanionMedia {
  return {
    ref: media.ref, mediaId: media.mediaId, title: media.title.slice(0, 500),
    poster: media.poster, backdrop: media.backdrop, mediaKind: media.mediaKind,
    genres: media.genres?.slice(0, 12), releaseYear: media.releaseYear,
    contentRating: media.contentRating, isAdult: media.isAdult, resolver: media.resolver,
    description: media.description?.slice(0, 520), runtimeMinutes: media.runtimeMinutes,
    recommendation: media.recommendation, trailer: media.trailer,
  }
}
export function persistDiscoveryChoice(choice: DiscoveryChoice): void {
  if (!validDiscoveryChoice(choice)) return
  choice = { ...choice, media: discoveryChoiceMedia(choice.media) }
  const records = readDiscoveryChoices(), key = discoveryKey(choice.media)
  if ((records[key]?.at ?? 0) > choice.at) return
  if (JSON.stringify(records[key]) === JSON.stringify(choice)) return
  records[key] = choice
  localStorage.setItem(tvProfileStorageKey('izumi.discovery.v2'), JSON.stringify(Object.fromEntries(
    Object.entries(records).sort((a, b) => b[1].at - a[1].at).slice(0, 500),
  )))
  window.dispatchEvent(new Event(DISCOVERY_CHANGED))
}
/** Consume ranked results over the encrypted companion protocol. The AGPL ranking
 * implementation stays in the main client; the TV does not contain or execute it.
 * Offline choices hide cards immediately. The next linked-device sync re-ranks. */
export function tvDiscoveryDeck(snapshot: CompanionHomeSnapshot, choices: Record<string, DiscoveryChoice>, now = Date.now()) {
  const pool = snapshot.discovery?.candidates ?? snapshot.rows.flatMap(row => row.items)
  const decisions = new Map((snapshot.discovery?.decisions ?? []).map(choice => [choice.key, choice]))
  for (const [key, choice] of Object.entries(choices)) if (choice.at >= (decisions.get(key)?.at ?? 0)) {
    decisions.set(key, { key, action: choice.action, at: choice.at })
  }
  const excluded = new Set([
    ...snapshot.discovery?.excluded ?? [],
    ...(snapshot.history ?? []).map(discoveryKey),
    ...pool.filter(media => media.inMyList).map(discoveryKey),
  ])
  const seen = new Set<string>()
  return pool.filter(media => {
    const key = discoveryKey(media), choice = decisions.get(key)
    if (!tvAllowsMedia(media) || seen.has(key) || excluded.has(key)) return false
    seen.add(key)
    return !choice || choice.action === 'undo' || (choice.action === 'skip' && now - choice.at >= 7 * 86400000)
  }).slice(0, 60).map(media => ({
    key: discoveryKey(media), media,
    reason: media.recommendation?.reason ?? 'Explore your enabled catalogs',
    evidence: media.recommendation?.evidence ?? ['Connect the main Izumi client for personalized picks and explanations.'],
    exploration: media.recommendation?.exploration ?? true,
  }))
}
