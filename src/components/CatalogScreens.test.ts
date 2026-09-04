import { describe, expect, it } from 'vitest'
import {
  SEARCH_KEYS,
  TRAILER_LISTENING_MESSAGE,
  adjacentSearchKey,
  contributorsFor,
  detailActionsFor,
  nearestSearchKey,
  seriesOverviewActionsFor,
  trailerPlaybackState,
  youtubeTrailerId,
} from './CatalogScreens'

describe('TV search keyboard geometry', () => {
  it('uses a six-column alphabetic grid with compact input actions', () => {
    expect(SEARCH_KEYS.filter((key) => key.row === 1).map((key) => key.value).join('')).toBe('abcdef')
    expect(SEARCH_KEYS.filter((key) => key.row === 5).map((key) => key.value).join('')).toBe('yz1234')
    expect(SEARCH_KEYS.filter((key) => key.row === 6).map((key) => key.value).join('')).toBe('567890')
    expect(SEARCH_KEYS.find((key) => key.value === 'SPACE')).toMatchObject({ row: 0, column: 0, span: 2 })
    expect(SEARCH_KEYS.find((key) => key.value === 'DELETE')).toMatchObject({ row: 0, column: 2, span: 2 })
    expect(SEARCH_KEYS.find((key) => key.value === 'VOICE')).toMatchObject({ row: 0, column: 4, span: 2 })
  })

  it('moves spatially instead of wrapping at a row edge', () => {
    expect(adjacentSearchKey(0, 'left')).toBeUndefined()
    expect(SEARCH_KEYS[adjacentSearchKey(0, 'right')!].value).toBe('b')
    expect(SEARCH_KEYS[adjacentSearchKey(0, 'up')!].value).toBe('SPACE')
    expect(SEARCH_KEYS[nearestSearchKey(6, 5.5)].value).toBe('0')
  })

  it('keeps the same column when moving through a double-width action key', () => {
    const b = SEARCH_KEYS.findIndex((key) => key.value === 'b')
    const space = adjacentSearchKey(b, 'up', 1)!
    expect(SEARCH_KEYS[space].value).toBe('SPACE')
    expect(SEARCH_KEYS[adjacentSearchKey(space, 'down', 1)!].value).toBe('b')

    const e = SEARCH_KEYS.findIndex((key) => key.value === 'e')
    const voice = adjacentSearchKey(e, 'up', 4)!
    expect(SEARCH_KEYS[voice].value).toBe('VOICE')
    expect(SEARCH_KEYS[adjacentSearchKey(voice, 'down', 4)!].value).toBe('e')
  })

  it('moves straight down in every complete alphanumeric column', () => {
    for (let row = 1; row < 6; row += 1) {
      for (let column = 0; column < 6; column += 1) {
        const current = SEARCH_KEYS.findIndex((key) => key.row === row && key.column === column)
        const next = adjacentSearchKey(current, 'down', column)
        expect(SEARCH_KEYS[next!]).toMatchObject({ row: row + 1, column })
      }
    }
  })
})

describe('TV trailer iframe control', () => {
  it('uses the YouTube widget handshake and maps its playback states', () => {
    expect(TRAILER_LISTENING_MESSAGE).toEqual({ event: 'listening', id: 1, channel: 'widget' })
    expect(trailerPlaybackState(1)).toBe('playing')
    expect(trailerPlaybackState(2)).toBe('paused')
    expect(trailerPlaybackState(3)).toBe('buffering')
    expect(trailerPlaybackState(0)).toBe('ended')
    expect(trailerPlaybackState({ playerState: 1 })).toBe('playing')
  })
})

describe('series overview actions', () => {
  const media = {
    ref: { provider: 'anilist', id: '1', type: 'anime' },
    title: 'Example series',
  }

  it('keeps play as the primary action and exposes only supported destinations', () => {
    expect(seriesOverviewActionsFor(media)).toEqual(['play', 'trailer'])
    expect(seriesOverviewActionsFor({
      ...media,
      seasonEpisodeCounts: [12, 10],
      trailer: { id: 'Iwr1aLEDpe4', site: 'youtube' },
      relations: [{ relationType: 'SEQUEL', media }],
    })).toEqual(['play', 'episodes', 'trailer', 'relations'])
  })

  it('keeps cast and crew identities available for filtered discovery', () => {
    expect(contributorsFor({
      ...media,
      cast: [{ id: '10', provider: 'tmdb', name: 'Actor One', role: 'Detective', credit: 'cast' }],
      crew: [{ id: '20', provider: 'tmdb', name: 'Director Two', role: 'Director', credit: 'crew' }],
    })).toEqual([
      { id: '10', provider: 'tmdb', name: 'Actor One', role: 'Detective', credit: 'cast' },
      { id: '20', provider: 'tmdb', name: 'Director Two', role: 'Director', credit: 'crew' },
    ])
  })

  it('does not expose unsupported trailer providers', () => {
    expect(seriesOverviewActionsFor({ ...media, trailer: { id: '12345', site: 'vimeo' } })).toEqual(['play', 'trailer'])
    expect(detailActionsFor(media)).toEqual(['play', 'trailer', 'close'])
  })

  it('accepts only canonical YouTube IDs or URLs', () => {
    expect(youtubeTrailerId({ ...media, trailer: { id: 'Iwr1aLEDpe4', site: 'youtube' } })).toBe('Iwr1aLEDpe4')
    expect(youtubeTrailerId({ ...media, trailer: { id: 'https://youtu.be/Iwr1aLEDpe4', site: 'youtube' } })).toBe('Iwr1aLEDpe4')
    expect(youtubeTrailerId({ ...media, trailer: { id: 'too-short', site: 'youtube' } })).toBeUndefined()
  })
})
