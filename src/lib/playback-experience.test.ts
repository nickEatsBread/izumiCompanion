import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import {
  activeSkipSegment,
  defaultPlaybackExperienceSettings,
  nextEpisodeFor,
  postPlayRecommendations,
  readPlaybackExperienceSettings,
  shouldOfferNextEpisode,
  skipSegmentLabel,
  writePlaybackExperienceSettings,
} from './playback-experience'

const series: CompanionMedia = {
  ref: { provider: 'anilist', id: '1', type: 'anime' },
  title: 'Example',
  season: 1,
  episode: 1,
  episodes: [
    { season: 2, episode: 1, title: 'A new season' },
    { season: 1, episode: 2, title: 'The next step' },
    { season: 1, episode: 1, title: 'The beginning' },
  ],
}

describe('playback experience', () => {
  beforeEach(() => {
    const values: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value },
      removeItem: (key: string) => { delete values[key] },
      clear: () => Object.keys(values).forEach((key) => delete values[key]),
    })
  })

  it('finds the next released episode across ordered seasons', () => {
    expect(nextEpisodeFor(series)?.media).toMatchObject({ season: 1, episode: 2, episodeTitle: 'The next step' })
    expect(nextEpisodeFor({ ...series, season: 1, episode: 2 })?.media).toMatchObject({ season: 2, episode: 1 })
  })

  it('does not offer an unreleased episode', () => {
    const future = { ...series, episodes: [{ season: 1, episode: 1 }, { season: 1, episode: 2, releasedAt: '2999-01-01T00:00:00Z' }] }
    expect(nextEpisodeFor(future)).toBeUndefined()
  })

  it('falls back to season counts when detailed episode metadata is unavailable', () => {
    const summary = { ...series, episodes: undefined, seasonEpisodeCounts: [2, 3], season: 1, episode: 2 }
    expect(nextEpisodeFor(summary)?.media).toMatchObject({ season: 2, episode: 1 })
  })

  it('uses an ending segment or the 98 percent fallback for next episode timing', () => {
    const segments = [{ type: 'ending' as const, startTime: 1_200, endTime: 1_300 }]
    expect(shouldOfferNextEpisode(1_199, 1_400, segments)).toBe(false)
    expect(shouldOfferNextEpisode(1_200, 1_400, segments)).toBe(true)
    expect(shouldOfferNextEpisode(979, 1_000, [])).toBe(false)
    expect(shouldOfferNextEpisode(980, 1_000, [])).toBe(true)
  })

  it('offers each active skip segment once and labels it clearly', () => {
    const intro = { type: 'op' as const, startTime: 10, endTime: 100 }
    expect(activeSkipSegment([intro], 20)).toEqual(intro)
    expect(activeSkipSegment([intro], 20, ['op:10:100'])).toBeUndefined()
    expect(skipSegmentLabel('op')).toBe('Skip intro')
    expect(skipSegmentLabel('credits')).toBe('Skip credits')
  })

  it('prefers authored recommendations and removes duplicates', () => {
    const recommendation = { ...series, ref: { ...series.ref, id: '2' }, title: 'Recommendation' }
    expect(postPlayRecommendations({ ...series, recommendations: [recommendation, recommendation] }, [])).toEqual([recommendation])
  })

  it('persists safe defaults and explicit preferences', () => {
    expect(readPlaybackExperienceSettings()).toEqual(defaultPlaybackExperienceSettings)
    const settings = { ...defaultPlaybackExperienceSettings, autoplayNextEpisode: true }
    writePlaybackExperienceSettings(settings)
    expect(readPlaybackExperienceSettings()).toEqual(settings)
  })
})
