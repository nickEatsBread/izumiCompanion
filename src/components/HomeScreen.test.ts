import { describe, expect, it } from 'vitest'
import type { CompanionMedia } from '../types'
import {
  HOME_CAROUSEL_POSTER_HEIGHT,
  HOME_CAROUSEL_POSTER_STRIDE,
  HOME_CAROUSEL_POSTER_WIDTH,
  HOME_FOCUS_WIDTH,
  HOME_POSTER_HEIGHT,
  HOME_POSTER_STRIDE,
  HOME_POSTER_WIDTH,
  achievementLabelParts,
  displayRatings,
  homeCardContext,
  achievementIconName,
  homeCarouselRowTop,
  homeFocusMotion,
  homeRowTop,
  homeRowVisible,
  informativeHeroMeta,
  mediaFactTokens,
  ratingDisplayValue,
  titleFallbackVisible,
} from './HomeScreen'

const media = (subtitle?: string, contentRating?: string): CompanionMedia => ({
  ref: { provider: 'preview', type: 'series', id: 'test' },
  title: 'Test series',
  poster: 'poster.jpg',
  subtitle,
  contentRating,
})

describe('TV home presentation', () => {
  it('uses living-room scale cards with a fixed, non-reflowing stride', () => {
    expect([HOME_POSTER_WIDTH, HOME_POSTER_HEIGHT, HOME_POSTER_STRIDE]).toEqual([320, 480, 340])
    expect(HOME_FOCUS_WIDTH).toBe(HOME_POSTER_WIDTH * 3)
    expect([HOME_CAROUSEL_POSTER_WIDTH, HOME_CAROUSEL_POSTER_HEIGHT, HOME_CAROUSEL_POSTER_STRIDE]).toEqual([238, 340, 254])
  })

  it('renders the active row and its immediate neighbors without mounting distant artwork', () => {
    expect(homeRowVisible(0, 0)).toBe(true)
    expect(homeRowVisible(1, 0)).toBe(true)
    expect(homeRowVisible(2, 0)).toBe(false)
    expect(homeRowVisible(3, 0)).toBe(false)
    expect(homeRowVisible(2, 3)).toBe(true)
  })

  it('pins the focused row high and leaves the next rail visible at TV scale', () => {
    expect(homeRowTop(2, 2, true)).toBe(52)
    expect(homeRowTop(3, 2, true)).toBe(824)
    expect(homeRowTop(4, 2, true)).toBe(1340)
    expect(homeRowTop(0, 0, false)).toBe(24)
    expect(homeCarouselRowTop(2, 2, true)).toBe(24)
    expect(homeCarouselRowTop(3, 2, true)).toBe(444)
  })

  it('removes generic media type labels from the hero metadata', () => {
    expect(informativeHeroMeta(media('TV'))).toBe('Show')
    expect(informativeHeroMeta(media('TV · 2024 · 12 Episodes', 'TV-14'))).toBe('Show  ·  2024  ·  12 Episodes  ·  TV-14')
  })

  it('puts episode and time-left copy beneath a focused Continue Watching tile', () => {
    expect(homeCardContext({
      ...media(),
      season: 3,
      episode: 4,
      episodeTitle: 'Old Friends',
      episodeProgress: .5,
      episodeRuntimeMinutes: 40,
    }, true)).toEqual({
      facts: ['S3 E4', 'Old Friends'],
      secondary: '20m left',
    })
  })

  it('uses source-neutral title facts instead of repeating the shelf name', () => {
    expect(homeCardContext({
      ...media(undefined, 'TV-14'),
      mediaKind: 'show',
      genres: ['Fantasy', 'Adventure'],
      releaseYear: 2024,
      seasonEpisodeCounts: [12],
      placement: { label: 'Trending This Week', position: 4, kind: 'ranking' },
    }, false)).toEqual({
      facts: ['Show', 'Fantasy', '2024', '12 episodes', 'TV-14'],
    })
    expect(mediaFactTokens({ ...media(), mediaKind: 'movie', runtimeMinutes: 95 })).toEqual(['Movie', '1h 35m'])
  })

  it('uses a distinct icon language for different achievement types', () => {
    expect(achievementIconName('trending')).toBe('flame')
    expect(achievementIconName('popularity')).toBe('users')
    expect(achievementIconName('rating')).toBe('trophy')
    const kinds = ['trending', 'popularity', 'rating'] as const
    expect(new Set(kinds.map(achievementIconName)).size).toBe(3)
  })

  it('separates rank emphasis from readable, capitalized achievement context', () => {
    expect(achievementLabelParts('#31 highest rated 2022')).toEqual({ lead: '#31', context: 'Highest rated 2022' })
    expect(achievementLabelParts('84% user score')).toEqual({ lead: '84%', context: 'User score' })
  })

  it('formats supplied rating scales without inventing missing ratings', () => {
    expect(displayRatings(media())).toEqual([])
    expect(ratingDisplayValue({ source: 'IMDb', score: 8.6, scale: 10 })).toBe('8.6')
    expect(ratingDisplayValue({ source: 'Rotten Tomatoes', score: 91, scale: 100 })).toBe('91%')
    expect(ratingDisplayValue({ source: 'Metacritic', score: 74, scale: 100 })).toBe('74')
  })

  it('describes horizontal and vertical spotlight movement for the TV transition', () => {
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 1 }, { zone: 'row', row: 0, index: 2 })).toBe('forward')
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 2 }, { zone: 'row', row: 0, index: 1 })).toBe('backward')
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 4 }, { zone: 'row', row: 0, index: 0 }, 5)).toBe('forward')
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 2 }, { zone: 'row', row: 1, index: 0 })).toBe('vertical')
  })

  it('never leaves a focused spotlight title blank while provider artwork is pending', () => {
    expect(titleFallbackVisible(undefined, false, true)).toBe(true)
    expect(titleFallbackVisible(undefined, false, false)).toBe(false)
    expect(titleFallbackVisible(undefined, true, false)).toBe(true)
    expect(titleFallbackVisible('logo.png', false, true)).toBe(false)
    expect(titleFallbackVisible('logo.png', false, true, true)).toBe(true)
  })
})
