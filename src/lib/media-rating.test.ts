import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'
import { hasStartedWatching, mediaRatingKey, readMediaRatings, writeMediaRating } from './media-rating'

const media: CompanionMedia = { ref: { provider: 'tmdb', type: 'movie', id: '42' }, title: 'Example' }

describe('rating eligibility', () => {
  it('does not treat browsing, selecting an episode, or a trailer as playback', () => {
    expect(hasStartedWatching({ ...media, season: 2, episode: 8, progress: 0, episodeProgress: 0,
      inMyList: true, trailer: { id: 'Iwr1aLEDpe4' }, episodes: [{ season: 1, episode: 1 }] })).toBe(false)
    expect(hasStartedWatching({ ...media, progress: NaN, resumePositionSeconds: -1 })).toBe(false)
  })

  it('recognises movie, episode, exact checkpoint, and completed episode progress', () => {
    for (const watched of [
      { progress: .2 }, { episodeProgress: .01 }, { resumePositionSeconds: 1 }, { episodeProgress: 1 },
      { episodes: [{ season: 1, episode: 4, watched: true }] },
      { episodes: [{ season: 2, episode: 1, progress: .1 }] },
    ]) expect(hasStartedWatching({ ...media, ...watched })).toBe(true)
  })

  it('recognises linked history and a next-episode continue row without leaking across titles', () => {
    const snapshot: CompanionHomeSnapshot = { app: 'izumi', kind: 'companion-home', version: 1,
      revision: '1', generatedAt: 1, catalog: { screen: 'movies', label: 'Movies' }, rows: [], history: [media] }
    expect(hasStartedWatching(media, snapshot)).toBe(true)
    expect(hasStartedWatching({ ...media, ref: { ...media.ref, type: 'tv' } }, snapshot)).toBe(false)
    expect(hasStartedWatching(media, { ...snapshot, history: [], rows: [
      { id: 'continue', title: 'Continue watching', kind: 'continue', items: [{ ...media, episode: 2, episodeProgress: 0 }] },
    ] })).toBe(true)
    expect(hasStartedWatching(media, { ...snapshot, history: [], rows: [
      { id: 'popular', title: 'Popular', kind: 'catalog', items: [media] },
    ] })).toBe(false)
  })
})

describe('media ratings', () => {
  beforeEach(() => {
    const values: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value },
    })
  })

  it('persists one title-level preference and toggles a repeated choice off', () => {
    const rated = writeMediaRating({}, media, 'up', 100)
    expect(rated[mediaRatingKey(media)]).toEqual({ value: 'up', updatedAt: 100 })
    expect(readMediaRatings()).toEqual(rated)
    expect(writeMediaRating(rated, { ...media, episode: 8 }, 'up', 200)).toEqual({})
  })

  it('replaces an opposite preference', () => {
    const liked = writeMediaRating({}, media, 'up', 100)
    expect(writeMediaRating(liked, media, 'down', 200)[mediaRatingKey(media)]).toEqual({ value: 'down', updatedAt: 200 })
  })
})
