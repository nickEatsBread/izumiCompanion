import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionMedia } from '../types'
import { mediaRatingKey, readMediaRatings, writeMediaRating } from './media-rating'

const media: CompanionMedia = { ref: { provider: 'tmdb', type: 'movie', id: '42' }, title: 'Example' }

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
