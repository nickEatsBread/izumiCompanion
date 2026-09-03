import { describe, expect, it } from 'vitest'
import type { CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia } from '../types'
import {
  homeHeroItems,
  isMergedCatalog,
  mergedCatalogOption,
  orderedHomeRows,
  rememberedHomeRowIndex,
  wrappedHeroIndex,
} from './home-navigation'

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

  it('keeps an independent horizontal position for every home rail', () => {
    const continueRow = row('continue', 'Continue Watching', 'continue', [media('one'), media('two')])
    const popularRow = row('popular', 'Popular this season', 'catalog', [media('one'), media('two'), media('three')])

    expect(rememberedHomeRowIndex(popularRow, { continue: 1 })).toBe(0)
    expect(rememberedHomeRowIndex(popularRow, { continue: 1, popular: 2 })).toBe(2)
    expect(rememberedHomeRowIndex(continueRow, { continue: 20 })).toBe(1)
  })

  it('resolves Browse to the linked client merged catalogue', () => {
    const snapshot: CompanionHomeSnapshot = {
      app: 'izumi',
      kind: 'companion-home',
      version: 1,
      revision: 'catalogues',
      generatedAt: 1,
      catalog: {
        screen: 'auto',
        label: 'Automatic anime',
        options: [
          { screen: 'auto', label: 'Automatic anime' },
          { screen: 'all-providers', label: 'Merged' },
        ],
      },
      rows: [],
    }

    expect(mergedCatalogOption(snapshot)).toEqual({ screen: 'all-providers', label: 'Merged' })
    expect(isMergedCatalog(snapshot)).toBe(false)
    expect(isMergedCatalog({ ...snapshot, catalog: { ...snapshot.catalog, screen: 'all-providers', label: 'Merged' } })).toBe(true)
  })

  it('uses the stable merged screen id when an older client omits catalogue options', () => {
    const snapshot: CompanionHomeSnapshot = {
      app: 'izumi',
      kind: 'companion-home',
      version: 1,
      revision: 'legacy',
      generatedAt: 1,
      catalog: { screen: 'auto', label: 'Automatic anime' },
      rows: [],
    }

    expect(mergedCatalogOption(snapshot)).toEqual({ screen: 'merged', label: 'Merged' })
  })
})
