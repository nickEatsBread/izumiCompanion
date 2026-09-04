import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { chooseTvProfile, filterTvSnapshot, lockTvProfiles, resetTvHousehold, snapshotMatchesTvProfile, tvAllowsMedia, tvHousehold, tvProfileId, tvProfileReady, tvProfileScope, tvProfileStorageKey, updateTvHousehold } from './profiles'
import { readPlaybackProgress, savePlaybackProgress } from './playback-progress'
import type { CompanionHomeSnapshot, CompanionMedia, PlaybackSnapshot } from '../types'

const main = { id: 'default', name: 'Alex', color: '#457b9d', createdAt: 1, ratingLimit: 18, allowAdult: true }
const child = { ...main, id: 'child', name: 'Mina', ratingLimit: 12, allowAdult: false }
let values: Map<string, string>
beforeEach(() => {
  values = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  vi.stubGlobal('crypto', webcrypto)
  resetTvHousehold()
})
afterEach(() => { resetTvHousehold(); vi.unstubAllGlobals() })
describe('TV household profiles', () => {
  it('leaves a new TV in single-user mode', () => {
    expect(tvHousehold().enabled).toBe(false)
    expect(tvProfileReady()).toBe(true)
    expect(tvProfileStorageKey('progress')).toBe('progress')
  })
  it('requires selection on startup and ignores older roster updates', async () => {
    updateTvHousehold({ enabled: true, modeUpdatedAt: 2, profiles: [main, child] })
    expect(tvProfileReady()).toBe(false)
    await chooseTvProfile('child')
    expect(tvProfileId()).toBe('child')
    expect(tvProfileStorageKey('progress')).toBe('progress:child')
    updateTvHousehold({ enabled: false, modeUpdatedAt: 1, profiles: [main] })
    updateTvHousehold(undefined)
    expect(tvProfileId()).toBe('child')
    lockTvProfiles()
    expect(tvProfileReady()).toBe(false)
  })
  it('keeps PINs only in session memory and relocks when the PIN changes', async () => {
    const salt = 'ab'.repeat(16)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':1234'))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    updateTvHousehold({ enabled: true, profiles: [{ ...main, pin: { salt, hash } }, child] })
    expect(await chooseTvProfile('default', '0000')).toBe(false)
    expect(await chooseTvProfile('default', '1234')).toBe(true)
    expect(tvProfileScope().profilePin).toBe('1234')
    expect([...values.values()].some((value) => value.includes('profilePin'))).toBe(false)
    updateTvHousehold({ enabled: true, profiles: [{ ...main, updatedAt: 3, pin: { salt, hash: 'cc'.repeat(32) } }, child] })
    expect(tvProfileReady()).toBe(false)
    expect(tvProfileScope().profilePin).toBeUndefined()
  })
  it('isolates two viewers watching the same title and retains legacy main progress', async () => {
    const media: CompanionMedia = { title: 'Film', ref: { provider: 'tmdb', type: 'movie', id: '1' } }
    const checkpoint = (positionSeconds: number) => ({ positionSeconds, durationSeconds: 1000 }) as PlaybackSnapshot
    savePlaybackProgress(media, checkpoint(100))
    updateTvHousehold({ enabled: true, profiles: [main, child] })
    await chooseTvProfile('child')
    expect(readPlaybackProgress()).toEqual([])
    savePlaybackProgress(media, checkpoint(300))
    expect(readPlaybackProgress()[0].profileId).toBe('child')
    await chooseTvProfile('default')
    expect(readPlaybackProgress()[0].positionSeconds).toBe(100)
  })
  it('rejects another profile’s snapshot and filters restricted navigation collections', async () => {
    updateTvHousehold({ enabled: true, profiles: [main, child] })
    await chooseTvProfile('child')
    const media: CompanionMedia = { title: 'Mature', contentRating: 'TV-MA', ref: { provider: 'tmdb', type: 'movie', id: '1' } }
    const snapshot: CompanionHomeSnapshot = { app: 'izumi', kind: 'companion-home', version: 1, revision: '1', generatedAt: 1, catalog: { screen: 'tmdb', label: 'Home' }, rows: [], history: [media], views: { myList: [media] }, hero: media }
    expect(snapshotMatchesTvProfile(snapshot)).toBe(false)
    expect(snapshotMatchesTvProfile({ ...snapshot, profileId: 'child' })).toBe(true)
    expect(filterTvSnapshot(snapshot).views?.myList).toEqual([])
    expect(filterTvSnapshot(snapshot).hero).toBeUndefined()
    expect(tvAllowsMedia({ isAdult: true })).toBe(false)
  })
})
