import { describe, expect, it } from 'vitest'
import type { CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia } from '../types'
import {
  catalogMediaDestination,
  cyclicRailIndexes,
  homeDetailPrefetchTargets,
  homeHeroItems,
  isMergedCatalog,
  mergeHomeMediaDetails,
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
  it('routes ordinary catalogue titles to information pages instead of playback', () => {
    expect(catalogMediaDestination(media('show'))).toBe('series')
    expect(catalogMediaDestination({ ...media('legacy-show'), mediaKind: 'show', ref: { provider: 'tmdb', type: 'movie', id: 'legacy-show' } })).toBe('series')
    expect(catalogMediaDestination({ ...media('movie'), mediaKind: 'movie' })).toBe('details')
    expect(catalogMediaDestination({ ...media('movie-ref'), ref: { provider: 'tmdb', type: 'movie', id: 'movie-ref' } })).toBe('details')
  })

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

  it('caches focused presentation details without replacing shelf progress or placement', () => {
    const title = {
      ...media('hero'),
      progress: .4,
      placement: { label: 'Continue Watching', kind: 'continue' as const },
    }
    const snapshot: CompanionHomeSnapshot = {
      app: 'izumi',
      kind: 'companion-home',
      version: 1,
      revision: 'details',
      generatedAt: 1,
      catalog: { screen: 'preview', label: 'Preview' },
      hero: title,
      rows: [row('continue', 'Continue Watching', 'continue', [title])],
      views: { search: [title] },
    }
    const merged = mergeHomeMediaDetails(snapshot, {
      ...media('hero'),
      logoImage: 'https://img.example/logo.png',
      description: 'A detailed provider synopsis.',
      genres: ['Drama'],
      trailer: { id: 'Iwr1aLEDpe4', site: 'youtube' },
    })

    expect(merged.hero).toMatchObject({
      logoImage: 'https://img.example/logo.png',
      description: 'A detailed provider synopsis.',
      progress: .4,
      placement: { label: 'Continue Watching', kind: 'continue' },
    })
    expect(merged.rows[0].items[0].logoImage).toBe('https://img.example/logo.png')
    expect(merged.rows[0].items[0].titleArtSettled).toBe(true)
    expect(merged.rows[0].items[0].trailer?.id).toBe('Iwr1aLEDpe4')
    expect(merged.views?.search?.[0].genres).toEqual(['Drama'])
  })

  it('wraps featured navigation in both directions', () => {
    expect(wrappedHeroIndex(0, -1, 5)).toBe(4)
    expect(wrappedHeroIndex(4, 1, 5)).toBe(0)
    expect(wrappedHeroIndex(0, 1, 1)).toBe(0)
  })

  it('renders shelf neighbours as a cyclic window without duplicate filler cards', () => {
    expect(cyclicRailIndexes(10, 8, 4)).toEqual([8, 9, 0, 1])
    expect(cyclicRailIndexes(3, 2, 8)).toEqual([2, 0, 1])
    expect(cyclicRailIndexes(0, 4, 6)).toEqual([])
  })

  it('keeps an independent horizontal position for every home rail', () => {
    const continueRow = row('continue', 'Continue Watching', 'continue', [media('one'), media('two')])
    const popularRow = row('popular', 'Popular this season', 'catalog', [media('one'), media('two'), media('three')])

    expect(rememberedHomeRowIndex(popularRow, { continue: 1 })).toBe(0)
    expect(rememberedHomeRowIndex(popularRow, { continue: 1, popular: 2 })).toBe(2)
    expect(rememberedHomeRowIndex(continueRow, { continue: 20 })).toBe(1)
  })

  it('prefetches the immediate right and vertical destinations before a bounded look-ahead', () => {
    const rows = [
      row('first', 'First', 'catalog', [media('a'), media('b'), media('c'), media('d')]),
      row('second', 'Second', 'catalog', [media('e'), media('f'), media('g')]),
      row('third', 'Third', 'catalog', [media('h'), media('i')]),
    ]

    expect(homeDetailPrefetchTargets(rows, { zone: 'row', row: 1, index: 1 }, { first: 3, third: 1 })
      .map(({ ref }) => ref.id)).toEqual(['f', 'g', 'i', 'h', 'd', 'e'])
  })

  it('warms the first shelf before leaving the hero', () => {
    const rows = [
      row('first', 'First', 'catalog', [media('a'), media('b'), media('c'), media('d')]),
      row('second', 'Second', 'catalog', [media('e'), media('f')]),
    ]
    expect(homeDetailPrefetchTargets(rows, { zone: 'hero', index: 0 }, { first: 1, second: 1 })
      .map(({ ref }) => ref.id)).toEqual(['b', 'c', 'f', 'e', 'd', 'a'])
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
