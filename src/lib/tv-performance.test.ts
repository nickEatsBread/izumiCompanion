import { describe, expect, it } from 'vitest'
import { tvNow } from './tv-performance'

describe('legacy TV performance clock', () => {
  it('always returns a finite timestamp', () => {
    expect(Number.isFinite(tvNow())).toBe(true)
  })
})
