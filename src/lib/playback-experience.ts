import type {
  CompanionEpisode,
  CompanionMedia,
  CompanionSkipSegment,
  CompanionSkipSegmentType,
} from '../types'

export interface PlaybackExperienceSettings {
  homeCarouselLayout: boolean
  autoplayNextEpisode: boolean
  autoSkipSegments: boolean
  stillWatchingEnabled: boolean
  preferBingeSource: boolean
}

export interface NextEpisode {
  episode: CompanionEpisode
  media: CompanionMedia
}

export const PLAYER_SEEK_STEP_SECONDS = 10

export function seekHoldMultiplier(elapsedMs: number): 2 | 3 {
  return elapsedMs >= 1_400 ? 3 : 2
}

export function playerSeekTarget(
  positionSeconds: number,
  durationSeconds: number,
  direction: -1 | 1,
  multiplier = 1,
): number {
  const maximum = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER
  return Math.max(0, Math.min(maximum, positionSeconds + direction * PLAYER_SEEK_STEP_SECONDS * multiplier))
}

const STORAGE_KEY = 'izumi.companion.playback-experience'

export const defaultPlaybackExperienceSettings: PlaybackExperienceSettings = {
  homeCarouselLayout: false,
  autoplayNextEpisode: false,
  autoSkipSegments: false,
  stillWatchingEnabled: true,
  preferBingeSource: true,
}

export function readPlaybackExperienceSettings(): PlaybackExperienceSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<PlaybackExperienceSettings> | null
    if (!value || typeof value !== 'object') return { ...defaultPlaybackExperienceSettings }
    return {
      homeCarouselLayout: value.homeCarouselLayout === true,
      autoplayNextEpisode: value.autoplayNextEpisode === true,
      autoSkipSegments: value.autoSkipSegments === true,
      stillWatchingEnabled: value.stillWatchingEnabled !== false,
      preferBingeSource: value.preferBingeSource !== false,
    }
  } catch {
    return { ...defaultPlaybackExperienceSettings }
  }
}

export function writePlaybackExperienceSettings(settings: PlaybackExperienceSettings): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* TV storage is best-effort. */ }
}

export function nextEpisodeFor(media: CompanionMedia, now = Date.now()): NextEpisode | undefined {
  if (!Number.isFinite(media.episode) || media.resolver?.streamType === 'movie' || media.ref.type === 'movie') return undefined
  const currentSeason = Number.isFinite(media.season) ? Number(media.season) : 1
  if (!media.episodes?.length) {
    const counts = media.seasonEpisodeCounts ?? []
    if (!counts.length) return undefined
    let seasonIndex = counts.length === 1 ? 0 : Math.max(0, currentSeason - 1)
    let episode = Number(media.episode) + 1
    if (episode > (counts[seasonIndex] ?? 0)) {
      seasonIndex += 1
      while (seasonIndex < counts.length && !counts[seasonIndex]) seasonIndex += 1
      if (seasonIndex >= counts.length) return undefined
      episode = 1
    }
    const next = { season: counts.length === 1 ? currentSeason : seasonIndex + 1, episode }
    return { episode: next, media: { ...media, ...next, progress: undefined, episodeProgress: undefined, playback: undefined } }
  }
  const episodes = media.episodes.slice().sort((left, right) => left.season - right.season || left.episode - right.episode)
  const currentIndex = episodes.findIndex((episode) => episode.season === currentSeason && episode.episode === media.episode)
  const next = currentIndex >= 0 ? episodes[currentIndex + 1] : episodes.find((episode) => (
    episode.season > currentSeason || episode.season === currentSeason && episode.episode > Number(media.episode)
  ))
  if (!next || next.releasedAt && Date.parse(next.releasedAt) > now) return undefined
  return {
    episode: next,
    media: {
      ...media,
      season: next.season,
      episode: next.episode,
      episodeTitle: next.title,
      episodeImage: next.image,
      episodeRuntimeMinutes: next.runtimeMinutes,
      progress: undefined,
      episodeProgress: next.progress,
      playback: undefined,
    },
  }
}

export function activeSkipSegment(
  segments: CompanionSkipSegment[],
  positionSeconds: number,
  handledKeys: string[] = [],
): CompanionSkipSegment | undefined {
  return segments.find((segment) => {
    const key = skipSegmentKey(segment)
    return !handledKeys.includes(key)
      && positionSeconds >= segment.startTime
      && positionSeconds < segment.endTime - 0.25
  })
}

export function skipSegmentKey(segment: CompanionSkipSegment): string {
  return `${segment.type}:${segment.startTime}:${segment.endTime}`
}

export function skipSegmentLabel(type: CompanionSkipSegmentType): string {
  if (type === 'intro' || type === 'op' || type === 'mixed-op') return 'Skip intro'
  if (type === 'recap') return 'Skip recap'
  if (type === 'credits') return 'Skip credits'
  return 'Skip ending'
}

export function shouldOfferNextEpisode(
  positionSeconds: number,
  durationSeconds: number,
  segments: CompanionSkipSegment[],
): boolean {
  if (!durationSeconds || durationSeconds <= 0) return false
  const ending = segments
    .filter((segment) => ['outro', 'ed', 'mixed-ed', 'credits', 'ending'].includes(segment.type))
    .sort((left, right) => left.startTime - right.startTime)[0]
  const threshold = ending && ending.startTime >= durationSeconds * 0.6
    ? ending.startTime
    : durationSeconds * 0.98
  return positionSeconds >= threshold
}

export function postPlayRecommendations(media: CompanionMedia, catalogue: CompanionMedia[]): CompanionMedia[] {
  const authored = media.recommendations?.filter((item) => !sameMedia(item, media)) ?? []
  if (authored.length) return uniqueMedia(authored).slice(0, 8)
  return uniqueMedia(catalogue.filter((item) => !sameMedia(item, media))).slice(0, 8)
}

function uniqueMedia(items: CompanionMedia[]): CompanionMedia[] {
  const seen: Record<string, boolean> = {}
  return items.filter((item) => {
    const key = `${item.ref.provider}:${item.ref.type}:${item.ref.id}`
    if (seen[key]) return false
    seen[key] = true
    return true
  })
}

function sameMedia(left: CompanionMedia, right: CompanionMedia): boolean {
  return left.ref.provider === right.ref.provider
    && left.ref.type === right.ref.type
    && left.ref.id === right.ref.id
}
