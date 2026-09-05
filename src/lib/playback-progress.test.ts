import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionHomeSnapshot, CompanionMedia, PlaybackSnapshot } from '../types'
import { mediaWithPlaybackProgress, mergePlaybackProgress, readPlaybackProgress, savePlaybackProgress } from './playback-progress'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const media = (id = '550'): CompanionMedia => ({
  ref: { provider: 'tmdb', type: 'movie', id },
  mediaId: Number(id),
  title: `Title ${id}`,
  poster: `https://image.example/${id}.jpg`,
  cast: [{ id: '1', provider: 'tmdb', name: 'Actor', credit: 'cast' }],
  episodes: [{ season: 1, episode: 1, title: 'Pilot' }],
})

const status = (positionSeconds: number, durationSeconds = 1_000): PlaybackSnapshot => ({
  sessionId: 'session-1',
  state: 'playing',
  positionSeconds,
  durationSeconds,
})

const snapshot = (): CompanionHomeSnapshot => ({
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'one',
  generatedAt: 1,
  catalog: { screen: 'merged', label: 'Browse' },
  hero: media('1'),
  rows: [{ id: 'popular', title: 'Popular', kind: 'catalog', items: [media('1')] }],
  history: [],
})

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
})

describe('TV playback progress', () => {
  it('carries all episode checkpoints through catalog and detail refreshes across seasons', () => {
    const show = { ...media('1'), ref: { provider: 'tmdb', type: 'tv', id: '1' }, seasonEpisodeCounts: [2, 2] }
    savePlaybackProgress({ ...show, season: 1, episode: 1 }, status(900), 10_000)
    savePlaybackProgress({ ...show, season: 1, episode: 2 }, status(200), 10_001)
    savePlaybackProgress({ ...show, season: 2, episode: 1 }, status(600), 10_002)
    const records = readPlaybackProgress(10_003)
    const base = snapshot()
    base.rows[0].items = [show]
    const merged = mergePlaybackProgress(base, records)
    const details = mediaWithPlaybackProgress({ ...show, episodes: [
      { season: 1, episode: 1, title: 'Pilot', progress: 0 },
      { season: 1, episode: 2, title: 'Second', progress: 0 },
      { season: 2, episode: 1, title: 'Return', progress: 0 },
    ] }, merged, records)
    expect(details).toMatchObject({ season: 2, episode: 1, episodeProgress: .6, resumePositionSeconds: 600 })
    expect(details.episodes).toEqual([
      expect.objectContaining({ season: 1, episode: 1, title: 'Pilot', progress: 1, watched: true }),
      expect.objectContaining({ season: 1, episode: 2, title: 'Second', progress: .2, watched: false }),
      expect.objectContaining({ season: 2, episode: 1, title: 'Return', progress: .6, watched: false }),
    ])
  })

  it('hydrates a search result from the linked continue row without requiring a local checkpoint', () => {
    const base = snapshot()
    base.rows.unshift({ id: 'continue', title: 'Continue', kind: 'continue', items: [
      { ...media('1'), season: 3, episode: 5, episodeProgress: .45, resumePositionSeconds: 450 },
    ] })
    expect(mediaWithPlaybackProgress(media('1'), base, [])).toMatchObject({ season: 3, episode: 5, episodeProgress: .45, resumePositionSeconds: 450 })
  })

  it('stores a compact, exact checkpoint that survives a reload', () => {
    savePlaybackProgress({ ...media(), season: 2, episode: 4 }, status(347), 10_000)

    const [record] = readPlaybackProgress(10_001)
    expect(record).toMatchObject({
      recordKey: 'tmdb:movie:550:2:4',
      positionSeconds: 347,
      durationSeconds: 1_000,
      completed: false,
      updatedAt: 10_000,
    })
    expect(record.media.cast).toBeUndefined()
    expect(record.media.episodes).toBeUndefined()
  })

  it('inserts an absent title into Continue Watching with an exact resume point', () => {
    savePlaybackProgress({ ...media(), season: 1, episode: 3 }, status(250), 10_000)

    const merged = mergePlaybackProgress(snapshot(), readPlaybackProgress(10_001))
    const recovered = merged.rows[0].items[0]
    expect(merged.rows[0]).toMatchObject({ id: 'continue', kind: 'continue' })
    expect(recovered).toMatchObject({
      title: 'Title 550',
      season: 1,
      episode: 3,
      episodeProgress: 0.25,
      episodeRuntimeMinutes: 1_000 / 60,
      resumePositionSeconds: 250,
    })
    expect(merged.history?.[0].ref.id).toBe('550')
  })

  it('merges progress into an existing card without duplicating it', () => {
    const base = snapshot()
    base.rows.unshift({ id: 'continue', title: 'Continue Watching', kind: 'continue', items: [media()] })
    savePlaybackProgress({ ...media(), episode: 7 }, status(500), 10_000)

    const merged = mergePlaybackProgress(base, readPlaybackProgress(10_001))
    expect(merged.rows[0].items).toHaveLength(1)
    expect(merged.rows[0].items[0]).toMatchObject({ episode: 7, episodeProgress: 0.5, resumePositionSeconds: 500 })
  })

  it('does not resurrect a completed item in Continue Watching', () => {
    savePlaybackProgress(media(), status(900), 10_000)

    const merged = mergePlaybackProgress(snapshot(), readPlaybackProgress(10_001))
    expect(merged.rows.some((row) => row.kind === 'continue')).toBe(false)
    expect(merged.history?.[0]).toMatchObject({ title: 'Title 550', episodeProgress: 1 })
  })

  it('removes a just-completed episode but does not hide a newer episode from izumi', () => {
    savePlaybackProgress({ ...media(), season: 1, episode: 3 }, status(900), 10_000)
    const current = snapshot()
    current.rows.unshift({
      id: 'continue', title: 'Continue Watching', kind: 'continue',
      items: [{ ...media(), season: 1, episode: 3 }],
    })
    expect(mergePlaybackProgress(current, readPlaybackProgress(10_001)).rows.some((row) => row.kind === 'continue')).toBe(false)

    current.rows[0].items = [{ ...media(), season: 1, episode: 4 }]
    expect(mergePlaybackProgress(current, readPlaybackProgress(10_001)).rows[0].items[0].episode).toBe(4)
  })

  it('keeps only the newest 24 checkpoints', () => {
    for (let index = 1; index <= 30; index += 1) {
      savePlaybackProgress(media(String(index)), status(index), 10_000 + index)
    }

    const records = readPlaybackProgress(11_000)
    expect(records).toHaveLength(24)
    expect(records[0].media.ref.id).toBe('30')
    expect(records[records.length - 1]?.media.ref.id).toBe('7')
  })
})
