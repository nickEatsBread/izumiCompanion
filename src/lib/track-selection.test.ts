import { describe, expect, it } from 'vitest'
import { preferredTrack } from './track-selection'

describe('receiver track matching', () => {
  const tracks = [
    { type: 'AUDIO' as const, index: 2, language: 'eng', codec: 'AAC', label: 'ENG · 2ch' },
    { type: 'AUDIO' as const, index: 5, language: 'jpn', codec: 'AAC', label: 'JPN · 2ch' },
  ]

  it('matches BCP-47 sender languages to Samsung ISO-639 metadata', () => {
    expect(preferredTrack(tracks, { language: 'ja-JP' })?.index).toBe(5)
  })

  it('does not select a track for an empty or unrelated preference', () => {
    expect(preferredTrack(tracks, undefined)).toBeUndefined()
    expect(preferredTrack(tracks, { language: 'ko' })).toBeUndefined()
  })
})
