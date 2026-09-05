import { describe, expect, it } from 'vitest'
import { catalogCollections, episodeCountsFor, episodeProgressFor, mediaForEpisode, seriesPlaybackTarget, seasonIndexFor, seasonNumberFor } from './catalog'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'

const media = (id: string, type: string, extra: Partial<CompanionMedia> = {}): CompanionMedia => ({
  ref: { provider: 'anilist', id, type },
  title: id,
  ...extra,
})

const snapshot = (items: CompanionMedia[]): CompanionHomeSnapshot => ({
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'test',
  generatedAt: 1,
  catalog: { screen: 'anilist', label: 'AniList' },
  rows: [{ id: 'recommended', title: 'For You', kind: 'catalog', items }],
})

describe('TV catalogue collections', () => {
  it('does not present series as movies or recommendations as My List', () => {
    const series = media('series', 'anime')
    const movie = media('movie', 'movie')
    const saved = media('saved', 'anime', { inMyList: true })
    const result = catalogCollections(snapshot([series, movie, saved]))

    expect(result.movies).toEqual([movie])
    expect(result.myList).toEqual([saved])
    expect(result.trending).toEqual([])
  })

  it('never fabricates an episode count', () => {
    expect(episodeCountsFor(media('unknown', 'anime', { subtitle: '2 seasons' }))).toEqual([])
    expect(episodeCountsFor(media('known', 'anime', {
      episodes: [
        { season: 1, episode: 1 },
        { season: 1, episode: 4 },
        { season: 2, episode: 2 },
      ],
    }))).toEqual([4, 2])
  })

  it('keeps provider season numbers stable when specials are listed last', () => {
    const show = media('tmdb-show', 'series', {
      seasonEpisodeCounts: [8, 6, 3],
      seasonLabels: ['Season 1', 'Season 3', 'Specials'],
    })
    expect(seasonNumberFor(show, 1, show.seasonEpisodeCounts!)).toBe(3)
    expect(seasonNumberFor(show, 2, show.seasonEpisodeCounts!)).toBe(0)
    expect(seasonIndexFor(show, 3, show.seasonEpisodeCounts!)).toBe(1)
  })

  it('keeps watch history independent from My List', () => {
    const watched = media('watched', 'movie')
    const value = { ...snapshot([]), history: [watched] }
    expect(catalogCollections(value).history).toEqual([watched])
    expect(catalogCollections(value).myList).toEqual([])
  })
})

describe('series playback intent', () => {
  const show = (extra: Partial<CompanionMedia> = {}) => media('show', 'tv', { seasonEpisodeCounts: [2, 3], ...extra })

  it('starts a new series and resumes the exact episode independently of the season browser', () => {
    expect(seriesPlaybackTarget(show()).label).toBe('Play Season 1: Episode 1')
    const target = seriesPlaybackTarget(show({ season: 2, episode: 3, episodeProgress: .4, resumePositionSeconds: 600 }))
    expect(target.label).toBe('Resume Season 2: Episode 3')
    expect(target.media).toMatchObject({ season: 2, episode: 3, episodeProgress: .4, resumePositionSeconds: 600 })
  })

  it('keeps an exact checkpoint even when duration is unavailable', () => {
    const target = seriesPlaybackTarget(show({ season: 2, episode: 1, resumePositionSeconds: 120 }))
    expect(target.label).toBe('Resume Season 2: Episode 1')
    expect(target.media.resumePositionSeconds).toBe(120)
  })

  it('continues across a season boundary and replays a completed finale from the beginning', () => {
    const next = seriesPlaybackTarget(show({ season: 1, episode: 2, episodeProgress: 1, resumePositionSeconds: 1400 }))
    expect(next.label).toBe('Continue Season 2: Episode 1')
    expect(next.media.resumePositionSeconds).toBeUndefined()
    const finale = seriesPlaybackTarget(show({ season: 2, episode: 3, episodeProgress: 1 }))
    expect(finale.label).toBe('Play again Season 2: Episode 3')
    expect(finale.media.episodeProgress).toBeUndefined()
  })

  it('resumes another partly watched episode without leaking the current episode timestamp or source', () => {
    const target = mediaForEpisode(show({ season: 2, episode: 2, episodeProgress: .7, resumePositionSeconds: 1000,
      episodeTitle: 'Current', episodeImage: 'current.jpg', playback: { selection: 'manual', positionSeconds: 1000 },
      resolver: { streamType: 'series', videoId: 'current-video' },
      episodes: [{ season: 1, episode: 2, progress: .3, title: 'Earlier', videoId: 'earlier-video' }],
    }), 1, 2)
    expect(target).toMatchObject({ season: 1, episode: 2, episodeProgress: .3, episodeTitle: 'Earlier', resolver: { videoId: 'earlier-video' } })
    expect(target.resumePositionSeconds).toBeUndefined()
    expect(target.playback).toBeUndefined()
    expect(target.episodeImage).toBeUndefined()
  })

  it('uses fresh progress for the current episode and respects explicitly unwatched episodes', () => {
    const current = show({ season: 2, episode: 2, episodeProgress: .6 })
    expect(episodeProgressFor(current, { season: 2, episode: 2, progress: 0 })).toBe(.6)
    expect(episodeProgressFor(current, { season: 1, episode: 2 })).toBe(0)
    expect(episodeProgressFor(current, { season: 2, episode: 1, watched: false })).toBe(0)
    expect(episodeProgressFor(current, { season: 2, episode: 1 })).toBe(1)
  })
})
