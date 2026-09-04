import { describe, expect, it } from 'vitest'
import { popNavigationEntry, pushNavigationEntry } from './navigation-history'

describe('navigation history', () => {
  it('returns nested destinations in reverse order', () => {
    let history: string[] = pushNavigationEntry([], 'home')
    history = pushNavigationEntry(history, 'series')
    history = pushNavigationEntry(history, 'search')

    const search = popNavigationEntry(history)
    expect(search.entry).toBe('search')
    const series = popNavigationEntry(search.history)
    expect(series.entry).toBe('series')
    const home = popNavigationEntry(series.history)
    expect(home.entry).toBe('home')
  })

  it('caps retained pages for constrained TV memory', () => {
    let history: number[] = []
    for (let index = 0; index < 12; index += 1) history = pushNavigationEntry(history, index, 4)
    expect(history).toEqual([8, 9, 10, 11])
  })
})
