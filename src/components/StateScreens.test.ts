import { describe, expect, it } from 'vitest'
import { formatPlaybackTime } from './StateScreens'

describe('player time labels', () => {
  it('keeps short playback compact and formats long media as hours', () => {
    expect(formatPlaybackTime(169)).toBe('2:49')
    expect(formatPlaybackTime(10_163)).toBe('2:49:23')
  })
})
