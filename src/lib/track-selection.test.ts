import { describe, expect, it } from 'vitest'
import { applyTrackHints, preferredTrack, subtitleTrackLabel } from './track-selection'

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

  it('does not show a generic Subtitles placeholder as the track name', () => {
    expect(subtitleTrackLabel('Subtitles', 'eng', 0)).toBe('English')
    expect(subtitleTrackLabel('Subtitles 2', 'und', 1)).toBe('Subtitle 2')
    expect(subtitleTrackLabel('Signs & Songs', 'eng', 1)).toBe('English · Signs & Songs')
    expect(subtitleTrackLabel('Full Subtitles', undefined, 2)).toBe('Subtitle 3')
  })

  it('restores sender-resolved embedded subtitle names without changing Samsung indexes', () => {
    expect(applyTrackHints([
      { type: 'AUDIO', index: 1, language: 'jpn', codec: 'AAC', label: 'Japanese' },
      { type: 'TEXT', index: 4, language: 'eng', codec: 'ASS', label: 'Subtitles' },
      { type: 'TEXT', index: 7, language: 'eng', codec: 'ASS', label: 'Subtitles 2' },
    ], { subtitles: [
      { language: 'eng', codec: 'ass', label: 'English · Track 1' },
      { language: 'eng', codec: 'ass', label: 'English · Track 2' },
    ] })).toEqual([
      { type: 'AUDIO', index: 1, language: 'jpn', codec: 'AAC', label: 'Japanese' },
      { type: 'TEXT', index: 4, language: 'eng', codec: 'ASS', label: 'English · Track 1' },
      { type: 'TEXT', index: 7, language: 'eng', codec: 'ASS', label: 'English · Track 2' },
    ])
  })
})
