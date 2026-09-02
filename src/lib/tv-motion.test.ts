import { describe, expect, it } from 'vitest'
import { easeOutTvMotion, tvMotionValue } from './tv-motion'

describe('TV compositor motion', () => {
  it('uses a bounded ease-out curve', () => {
    expect(easeOutTvMotion(-1)).toBe(0)
    expect(easeOutTvMotion(0)).toBe(0)
    expect(easeOutTvMotion(.5)).toBeCloseTo(.875)
    expect(easeOutTvMotion(1)).toBe(1)
    expect(easeOutTvMotion(2)).toBe(1)
  })

  it('settles exactly on the requested target', () => {
    expect(tvMotionValue(0, -500, 0, 200)).toBe(0)
    expect(tvMotionValue(0, -500, 200, 200)).toBe(-500)
    expect(tvMotionValue(-220, -480, 10, 0)).toBe(-480)
  })
})
