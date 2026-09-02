import { describe, expect, it } from 'vitest'
import { SEARCH_KEYS, adjacentSearchKey, nearestSearchKey, seriesOverviewActionsFor } from './CatalogScreens'

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
})

describe('series overview actions', () => {
  const media = {
    ref: { provider: 'anilist', id: '1', type: 'anime' },
    title: 'Example series',
  }

  it('keeps play as the primary action and exposes only supported destinations', () => {
    expect(seriesOverviewActionsFor(media)).toEqual(['play'])
    expect(seriesOverviewActionsFor({
      ...media,
      seasonEpisodeCounts: [12, 10],
      trailer: { id: 'Iwr1aLEDpe4', site: 'youtube' },
      relations: [{ relationType: 'SEQUEL', media }],
    })).toEqual(['play', 'episodes', 'trailer', 'relations'])
  })

  it('does not expose unsupported trailer providers', () => {
    expect(seriesOverviewActionsFor({ ...media, trailer: { id: '12345', site: 'vimeo' } })).toEqual(['play'])
  })
})
