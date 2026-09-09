import { describe, expect, it } from 'vitest'
import { EARLY_START_GRACE_MS, EARLY_START_MAX_WAIT_MS, earlyStartDelay, observeEarlyStart } from './early-start'

describe('early playback start', () => {
  it('waits for nothing until a candidate exists', () => {
    expect(earlyStartDelay({}, 1_000)).toBeUndefined()
    expect(observeEarlyStart({}, undefined, 1_000)).toEqual({})
  })

  it('starts once the leading candidate has settled for the grace period', () => {
    const state = observeEarlyStart({}, 'a', 1_000)
    expect(earlyStartDelay(state, 1_000)).toBe(EARLY_START_GRACE_MS)
    expect(earlyStartDelay(state, 1_000 + EARLY_START_GRACE_MS)).toBe(0)
    expect(observeEarlyStart(state, 'a', 1_400)).toBe(state)
  })

  it('restarts the grace period when a better candidate takes the lead', () => {
    const first = observeEarlyStart({}, 'a', 1_000)
    const second = observeEarlyStart(first, 'b', 2_000)
    expect(second).toEqual({ firstAt: 1_000, topId: 'b', topSince: 2_000 })
    expect(earlyStartDelay(second, 2_000)).toBe(EARLY_START_GRACE_MS)
  })

  it('never waits longer than the overall cap while leaders keep changing', () => {
    let state = observeEarlyStart({}, 'a', 0)
    for (let step = 1; step <= 10; step++) state = observeEarlyStart(state, `c${step}`, step * 1_000)
    expect(earlyStartDelay(state, 10_000)).toBe(0)
    const late = observeEarlyStart(observeEarlyStart({}, 'a', 0), 'b', EARLY_START_MAX_WAIT_MS - 200)
    expect(earlyStartDelay(late, EARLY_START_MAX_WAIT_MS - 200)).toBe(200)
  })
})
