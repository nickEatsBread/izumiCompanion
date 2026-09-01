import { describe, expect, it } from 'vitest'
import { isCompanionSnapshot } from './types'

const validSnapshot = {
  app: 'izumi',
  kind: 'companion-home',
  version: 1,
  revision: 'current',
  generatedAt: 1,
  catalog: { screen: 'home', label: 'Home' },
  rows: [{
    id: 'continue',
    title: 'Continue Watching',
    kind: 'continue',
    items: [{
      ref: { provider: 'tmdb', id: '1399', type: 'tv' },
      title: 'Game of Thrones',
    }],
  }],
} as const

describe('companion snapshot validation', () => {
  it('accepts the current nested snapshot shape', () => {
    expect(isCompanionSnapshot(validSnapshot)).toBe(true)
  })

  it('rejects an older cached snapshot that has no catalog metadata', () => {
    const { catalog: _catalog, ...legacySnapshot } = validSnapshot
    expect(isCompanionSnapshot(legacySnapshot)).toBe(false)
  })

  it('rejects malformed cached rows before the catalog UI renders them', () => {
    expect(isCompanionSnapshot({
      ...validSnapshot,
      rows: [{ id: 'broken', title: 'Broken', kind: 'catalog', items: [{}] }],
    })).toBe(false)
  })
})
