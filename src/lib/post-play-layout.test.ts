import { describe, expect, it } from 'vitest'
import { nextPostPlayFocus, POST_PLAY_VIDEO_RECT } from './post-play-layout'

describe('post-play layout and navigation', () => {
  it('keeps the credits in a 16:9 rectangle clear of the recommendation copy', () => {
    const { x, y, width, height } = POST_PLAY_VIDEO_RECT
    expect(width / height).toBeCloseTo(16 / 9)
    expect(x).toBeGreaterThan(1052)
    expect(x + width).toBeLessThan(1920)
    expect(y + height).toBeLessThan(540)
  })

  it('reaches the top-right player from either rating and returns to the rating controls', () => {
    expect(nextPostPlayFocus(1, 'right', 'rating', true, true)).toBe(2)
    expect(nextPostPlayFocus(2, 'up', 'rating', true, true)).toBe(0)
    expect(nextPostPlayFocus(0, 'down', 'rating', true, true)).toBe(1)
  })

  it('keeps every displayed control reachable with or without recommendations and a player', () => {
    for (const hasItems of [true, false]) for (const mini of [true, false]) {
      const expected = [1, 2, 5, ...(hasItems ? [3, 4] : []), ...(mini ? [0] : [])]
      const visited = new Set([1])
      const pending = [1]
      while (pending.length) {
        const focus = pending.shift()!
        for (const action of ['left', 'right', 'up', 'down'] as const) {
          const next = nextPostPlayFocus(focus, action, 'recommendations', hasItems, mini)
          expect(expected).toContain(next)
          if (!visited.has(next)) { visited.add(next); pending.push(next) }
        }
      }
      expect([...visited].sort()).toEqual(expected.sort())
    }
  })
})
