import { readDiscoveryChoices } from './discovery'
import type {
  CompanionEpisode,
  CompanionHomeSnapshot,
  CompanionMedia,
} from '../types'

export interface CatalogCollections {
  search: CompanionMedia[]
  trending: CompanionMedia[]
  series: CompanionMedia[]
  movies: CompanionMedia[]
  myList: CompanionMedia[]
  history: CompanionMedia[]
}

function mediaKey(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

export function uniqueMedia(items: CompanionMedia[]): CompanionMedia[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = mediaKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function catalogCollections(snapshot: CompanionHomeSnapshot): CatalogCollections {
  const rowItems = uniqueMedia(snapshot.rows.reduce<CompanionMedia[]>((items, row) => items.concat(row.items), []))
  const search = uniqueMedia(snapshot.views?.search ?? rowItems)
  const rankedRows = snapshot.rows.filter((row) => /trending|popular|top\s*10|top rated/i.test(`${row.id} ${row.title}`))
  const rankedItems = rowItems.filter((item) => item.placement?.kind === 'ranking')
  const trending = uniqueMedia(snapshot.views?.trending ?? rankedRows.reduce<CompanionMedia[]>((items, row) => items.concat(row.items), []).concat(rankedItems))
    .sort((left, right) => (left.placement?.position ?? Number.MAX_SAFE_INTEGER) - (right.placement?.position ?? Number.MAX_SAFE_INTEGER))
  return {
    search,
    trending,
    series: uniqueMedia(snapshot.views?.series ?? search.filter((item) => item.ref.type !== 'movie')),
    movies: uniqueMedia(snapshot.views?.movies ?? search.filter((item) => item.ref.type === 'movie')),
    myList: uniqueMedia([...(snapshot.views?.myList ?? search.filter((item) => item.inMyList === true)), ...Object.values(readDiscoveryChoices()).filter(choice => choice.action === 'save').map(choice => choice.media)]),
    history: uniqueMedia(snapshot.history ?? []),
  }
}

export function episodeCountsFor(media: CompanionMedia): number[] {
  const supplied = media.seasonEpisodeCounts
    ?.map((count) => Number.isFinite(count) ? Math.min(9999, Math.floor(count)) : 0)
    .filter((count) => count > 0)
  if (supplied?.length) return supplied
  if (!media.episodes?.length) return []
  const seasons = new Map<number, number>()
  media.episodes.forEach((episode) => {
    if (!Number.isFinite(episode.season) || !Number.isFinite(episode.episode) || episode.episode < 1) return
    seasons.set(episode.season, Math.max(seasons.get(episode.season) ?? 0, Math.floor(episode.episode)))
  })
  return [...seasons.entries()].sort(([left], [right]) => left - right).map(([, count]) => count)
}

export function seasonNumberFor(media: CompanionMedia, seasonIndex: number, seasonCounts: number[]): number {
  if (media.seasonLabels?.[seasonIndex]) {
    if (/specials?/i.test(media.seasonLabels[seasonIndex])) return 0
    const parsed = Number(media.seasonLabels[seasonIndex].match(/\d+/)?.[0])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  const episodeSeasons = [...new Set(media.episodes?.map((episode) => episode.season) ?? [])].sort((left, right) => left - right)
  if (episodeSeasons[seasonIndex] !== undefined) return episodeSeasons[seasonIndex]
  return seasonCounts.length === 1 && media.season ? media.season : seasonIndex + 1
}

export function seasonIndexFor(media: CompanionMedia, seasonNumber: number, seasonCounts: number[]): number {
  const index = seasonCounts.findIndex((_, candidate) => seasonNumberFor(media, candidate, seasonCounts) === seasonNumber)
  return index < 0 ? 0 : index
}

export function episodeDetailsFor(media: CompanionMedia, seasonIndex: number, seasonCounts: number[]): CompanionEpisode[] {
  const seasonNumber = seasonNumberFor(media, seasonIndex, seasonCounts)
  const episodeCount = seasonCounts[seasonIndex] ?? 0
  if (!episodeCount) return []
  const supplied = new Map(
    media.episodes
      ?.filter((episode) => episode.season === seasonNumber)
      .map((episode) => [episode.episode, episode]) ?? [],
  )
  return Array.from({ length: episodeCount }, (_, index) => supplied.get(index + 1) ?? {
    season: seasonNumber,
    episode: index + 1,
    runtimeMinutes: media.episodeRuntimeMinutes,
  })
}

/** Episode progress is distinct from a title's overall series progress. */
export function episodeProgressFor(media: CompanionMedia, episode: CompanionEpisode): number {
  const current = episode.season === (media.season ?? 1) && episode.episode === media.episode
  const fraction = current && Number.isFinite(media.episodeProgress)
    ? media.episodeProgress!
    : episode.progress
  if (Number.isFinite(fraction)) return Math.max(0, Math.min(1, fraction!))
  if (episode.watched) return 1
  if (current && media.resumePositionSeconds && (episode.runtimeMinutes || media.episodeRuntimeMinutes)) {
    return Math.min(1, media.resumePositionSeconds / ((episode.runtimeMinutes || media.episodeRuntimeMinutes!) * 60))
  }
  if (episode.watched !== false && episode.season === (media.season ?? 1) && episode.episode < (media.episode ?? 1)) return 1
  return 0
}

/** Carry only the selected episode's resume point into a playback request. */
export function mediaForEpisode(media: CompanionMedia, season: number, episode: number): CompanionMedia {
  const detail = media.episodes?.find((item) => item.season === season && item.episode === episode)
  const current = season === (media.season ?? 1) && episode === media.episode
  const fraction = episodeProgressFor(media, detail ?? { season, episode })
  const resume = fraction < 1 && (fraction > 0 || current && (media.resumePositionSeconds ?? 0) > 0)
  return {
    ...media,
    season,
    episode,
    episodeTitle: detail?.title ?? (current ? media.episodeTitle : undefined),
    episodeImage: detail?.image ?? (current ? media.episodeImage : undefined),
    episodeRuntimeMinutes: detail?.runtimeMinutes ?? media.episodeRuntimeMinutes,
    episodeProgress: resume ? fraction : undefined,
    resumePositionSeconds: resume && current ? media.resumePositionSeconds : undefined,
    progress: resume ? media.progress : undefined,
    playback: undefined,
    resolver: media.resolver ? { ...media.resolver, videoId: detail?.videoId ?? (current ? media.resolver.videoId : undefined) } : undefined,
  }
}

export function seriesPlaybackTarget(media: CompanionMedia): { media: CompanionMedia; label: string } {
  const counts = episodeCountsFor(media)
  const episodes = counts.flatMap((_, index) => episodeDetailsFor(media, index, counts))
  let target = episodes.find((item) => item.season === (media.season ?? 1) && item.episode === media.episode)
  if (!target) target = episodes.find((item) => {
    const progress = episodeProgressFor(media, item)
    return progress > 0 && progress < 1
  }) ?? episodes.find((item) => item.season > 0) ?? episodes[0]
  let verb = 'Play'
  if (target && episodeProgressFor(media, target) >= 1) {
    const next = episodes.slice(episodes.indexOf(target) + 1).find((item) => episodeProgressFor(media, item) < 1)
    if (next) { target = next; verb = 'Continue' }
    else verb = 'Play again'
  }
  const season = target?.season ?? media.season ?? 1
  const episode = target?.episode ?? media.episode ?? 1
  const playback = mediaForEpisode(media, season, episode)
  if (playback.episodeProgress || playback.resumePositionSeconds) verb = 'Resume'
  return { media: playback, label: `${verb} Season ${season}: Episode ${episode}` }
}
