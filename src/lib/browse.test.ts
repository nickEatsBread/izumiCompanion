import { describe, expect, it } from 'vitest'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'
import { browseCategoryRows } from './browse'

const media = (provider: string, id: string, genres: string[], type = 'series'): CompanionMedia => ({
  ref: { provider, id, type }, title: id, genres,
})

const snapshot = (items: CompanionMedia[]): CompanionHomeSnapshot => ({
  app: 'izumi', kind: 'companion-home', version: 1, revision: 'browse', generatedAt: 1,
  catalog: { screen: 'merged', label: 'Merged' },
  rows: [{ id: 'popular', title: 'Popular', kind: 'catalog', items }],
  views: { search: items },
})

describe('merged TV Browse categories', () => {
  it('uses only supported categories and balances sources inside each rail', () => {
    const rows = browseCategoryRows(snapshot([
      media('tmdb', 'one', ['Drama', 'Crime']),
      media('anilist', 'two', ['Drama'], 'anime'),
      media('stremio', 'three', ['Drama', 'Crime']),
      media('tmdb', 'four', ['Crime']),
      media('stremio', 'five', ['Fantasy']),
      media('anilist', 'six', ['Fantasy'], 'anime'),
    ]))
    expect(rows.map((row) => row.title)).toEqual(['Dramas', 'Crime', 'Fantasy', 'Anime'])
    expect(rows[0].items.map((item) => item.ref.provider)).toEqual(['tmdb', 'anilist', 'stremio'])
    expect(rows.some((row) => row.title === 'Astrology')).toBe(false)
  })

  it('keeps provider-authored shelves when an older snapshot has no useful genres', () => {
    const input = snapshot([media('tmdb', 'one', [])])
    expect(browseCategoryRows(input)).toEqual(input.rows)
  })
})
