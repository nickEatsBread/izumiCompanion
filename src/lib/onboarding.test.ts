import { describe, expect, it } from 'vitest'
import { normalizeTvLinkCode, tvLinkUrl } from './onboarding'

describe('TV onboarding handoff', () => {
  it('normalizes a display-formatted code for the phone handoff', () => {
    expect(normalizeTvLinkCode('abcd 2345')).toBe('ABCD2345')
  })

  it('builds the live Cloudflare TV Link URL', () => {
    expect(tvLinkUrl('ABCD 2345')).toBe('https://tv-link.izumi.watch/?code=ABCD2345')
  })
})
