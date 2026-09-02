import { describe, expect, it } from 'vitest'
import type { CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia } from '../types'
import { homeHeroItems, orderedHomeRows, wrappedHeroIndex } from './home-navigation'

const media = (id: string): CompanionMedia => ({
  ref: { provider: 'preview', type: 'series', id },
  title: id,
})

const row = (id: string, title: string, kind: CompanionHomeRow['kind'], items = [media(id)]): CompanionHomeRow => ({
  id,
  title,
  kind,
  items,
})

describe('TV home navigation model', () => {
  it('puts Continue Watching before ranked and catalogue rows', () => {
    const rows = [row('new', 'New releases', 'catalog'), row('top', 'Trending now', 'catalog'), row('continue', 'Continue Watching', 'continue')]
    expect(orderedHomeRows(rows).map(({ id }) => id)).toEqual(['continue', 'top', 'new'])
  })

  it('builds a unique five-item hero rail from provider-ranked media', () => {
    const hero = media('hero')
    const snapshot: CompanionHomeSnapshot = {
      app: 'izumi',
      kind: 'companion-home',
      version: 1,
      revision: 'test',
      generatedAt: 1,
      catalog: { screen: 'preview', label: 'Preview' },
      hero,
      rows: [row('popular', 'Popular this week', 'catalog', [hero, media('two'), media('three'), media('four'), media('five'), media('six')])],
    }
    expect(homeHeroItems(snapshot).map(({ ref }) => ref.id)).toEqual(['hero', 'two', 'three', 'four', 'five'])
  })

  it('wraps featured navigation in both directions', () => {
    expect(wrappedHeroIndex(0, -1, 5)).toBe(4)
    expect(wrappedHeroIndex(4, 1, 5)).toBe(0)
    expect(wrappedHeroIndex(0, 1, 1)).toBe(0)
  })
})
