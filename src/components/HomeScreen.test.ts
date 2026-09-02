import { describe, expect, it } from 'vitest'
import type { CompanionMedia } from '../types'
import { informativeHeroMeta, leadingEdgeFor } from './HomeScreen'

const media = (subtitle?: string, contentRating?: string): CompanionMedia => ({
  ref: { provider: 'preview', type: 'series', id: 'test' },
  title: 'Test series',
  poster: 'poster.jpg',
  subtitle,
  contentRating,
})

describe('TV home presentation', () => {
  it('keeps a dimmed leading cover whenever focus has content to its left', () => {
    expect(leadingEdgeFor(0, 6)).toBe(-1)
    expect(leadingEdgeFor(1, 6)).toBe(0)
    expect(leadingEdgeFor(6, 6)).toBe(0)
    expect(leadingEdgeFor(7, 6)).toBe(1)
  })

  it('removes generic media type labels from the hero metadata', () => {
    expect(informativeHeroMeta(media('TV'))).toBe('')
    expect(informativeHeroMeta(media('TV · 2024 · 12 Episodes', 'TV-14'))).toBe('2024  ·  12 Episodes  ·  TV-14')
  })
})
