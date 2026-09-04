import { describe, expect, it } from 'vitest'
import { normalizeTvLinkCode, tvLinkUrl } from './onboarding'

describe('TV onboarding handoff', () => {
  it('normalizes a display-formatted code for the phone handoff', () => {
    expect(normalizeTvLinkCode('d6a 4e6')).toBe('D6A4E6')
  })

  it('builds the placeholder Cloudflare setup URL', () => {
    expect(tvLinkUrl('D6A 4E6')).toBe('https://tv-link.izumi.watch/?code=D6A4E6')
  })
})
