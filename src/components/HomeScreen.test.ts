import { describe, expect, it } from 'vitest'
import type { CompanionMedia } from '../types'
import { homeCardContext, homeFocusMotion, homeRowTop, homeRowVisible, informativeHeroMeta } from './HomeScreen'

const media = (subtitle?: string, contentRating?: string): CompanionMedia => ({
  ref: { provider: 'preview', type: 'series', id: 'test' },
  title: 'Test series',
  poster: 'poster.jpg',
  subtitle,
  contentRating,
})

describe('TV home presentation', () => {
  it('renders the active row and its immediate neighbors without mounting distant artwork', () => {
    expect(homeRowVisible(0, 0)).toBe(true)
    expect(homeRowVisible(1, 0)).toBe(true)
    expect(homeRowVisible(2, 0)).toBe(false)
    expect(homeRowVisible(3, 0)).toBe(false)
    expect(homeRowVisible(2, 3)).toBe(true)
  })

  it('pins the focused row high and leaves the next rail visible at TV scale', () => {
    expect(homeRowTop(2, 2, true)).toBe(52)
    expect(homeRowTop(3, 2, true)).toBe(704)
    expect(homeRowTop(4, 2, true)).toBe(1220)
    expect(homeRowTop(0, 0, false)).toBe(24)
  })

  it('removes generic media type labels from the hero metadata', () => {
    expect(informativeHeroMeta(media('TV'))).toBe('')
    expect(informativeHeroMeta(media('TV · 2024 · 12 Episodes', 'TV-14'))).toBe('2024  ·  12 Episodes  ·  TV-14')
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
      primary: 'S3 E4 · Old Friends',
      secondary: '20m left',
    })
  })

  it('uses title metadata and synopsis beneath other focused home tiles', () => {
    expect(homeCardContext({
      ...media('2024 · Fantasy', 'TV-14'),
      description: 'A deliberately concise synopsis.',
    }, false)).toEqual({
      primary: '2024  ·  Fantasy  ·  TV-14',
      description: 'A deliberately concise synopsis.',
    })
  })

  it('describes horizontal and vertical spotlight movement for the TV transition', () => {
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 1 }, { zone: 'row', row: 0, index: 2 })).toBe('forward')
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 2 }, { zone: 'row', row: 0, index: 1 })).toBe('backward')
    expect(homeFocusMotion({ zone: 'row', row: 0, index: 2 }, { zone: 'row', row: 1, index: 0 })).toBe('vertical')
  })
})
