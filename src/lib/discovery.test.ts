import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { discoveryChoiceMedia, discoveryKey, persistDiscoveryChoice, readDiscoveryChoices, tvDiscoveryDeck } from './discovery'
import { chooseTvProfile, resetTvHousehold, updateTvHousehold } from './profiles'
import type { CompanionHomeSnapshot, CompanionMedia } from '../types'
const film = (id: string): CompanionMedia => ({ ref: { provider: 'tmdb', type: 'movie', id }, title: 'Film ' + id, recommendation: { reason: 'Because you saved Arrival', evidence: ['Shared science-fiction themes.'], exploration: false } })
const a = film('a'), b = film('b')
const snapshot = (): CompanionHomeSnapshot => ({
  app: 'izumi', kind: 'companion-home', version: 1, revision: 'test', generatedAt: 1,
  catalog: { screen: 'merged', label: 'All catalogs' }, rows: [],
  discovery: { version: 2, candidates: [b, a, b], excluded: [], decisions: [] },
})
beforeEach(() => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  resetTvHousehold()
})
afterEach(() => { resetTvHousehold(); vi.unstubAllGlobals() })
describe('TV discovery result consumer', () => {
  it('retains the main client ordering and explanations without a local ranking engine', () => {
    const deck = tvDiscoveryDeck(snapshot(), {})
    expect(deck.map(item => item.key)).toEqual([discoveryKey(b), discoveryKey(a)])
    expect(deck[0].reason).toBe('Because you saved Arrival')
    expect(deck[0].evidence).toEqual(['Shared science-fiction themes.'])
  })
  it('applies offline choices and newer undo markers over stale snapshots', () => {
    const view = snapshot()
    view.discovery!.decisions = [{ key: discoveryKey(b), action: 'save', at: 10 }]
    expect(tvDiscoveryDeck(view, {}, 100).map(item => item.key)).toEqual([discoveryKey(a)])
    const undo = { profileId: 'default', media: b, action: 'undo' as const, at: 20 }
    expect(tvDiscoveryDeck(view, { [discoveryKey(b)]: undo }, 100)[0].key).toBe(discoveryKey(b))
  })
  it('expires skips after seven days and continues to exclude watched titles', () => {
    const view = snapshot()
    view.history = [a]
    const choice = { profileId: 'default', media: b, action: 'skip' as const, at: 100 }
    expect(tvDiscoveryDeck(view, { [discoveryKey(b)]: choice }, 200)).toHaveLength(0)
    expect(tvDiscoveryDeck(view, { [discoveryKey(b)]: choice }, 100 + 7 * 86400000)).toHaveLength(1)
  })
  it('isolates local choices by profile and rejects malformed timestamps', async () => {
    persistDiscoveryChoice({ profileId: 'default', media: a, action: 'save', at: Date.now() })
    persistDiscoveryChoice({ profileId: 'default', media: b, action: 'save', at: NaN })
    expect(Object.keys(readDiscoveryChoices())).toEqual([discoveryKey(a)])
    const base = { name: 'Viewer', color: '#123456', createdAt: 1, ratingLimit: 18, allowAdult: true }
    updateTvHousehold({ enabled: true, profiles: [{ ...base, id: 'default' }, { ...base, id: 'other' }] })
    await chooseTvProfile('other')
    expect(readDiscoveryChoices()).toEqual({})
  })
  it('never sends full detail trees in feedback', () => {
    const compact = discoveryChoiceMedia({ ...a, description: 'A'.repeat(2000), episodes: Array.from({ length: 1000 }, (_, i) => ({ episode: i, season: 1, title: 'Episode' })) })
    expect(compact.episodes).toBeUndefined()
    expect(compact.description).toHaveLength(520)
    expect(JSON.stringify(compact).length).toBeLessThan(2000)
  })
})
