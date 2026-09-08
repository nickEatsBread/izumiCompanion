import { describe, expect, it } from 'vitest'
import type { CompanionMedia } from '../types'
import { discoveryMediaFacts, discoveryRemoteFocus, discoverySynopsis, discoveryTrailer } from './discovery-navigation'

const media: CompanionMedia = { ref: { provider: 'tmdb', type: 'movie', id: '1' }, title: 'Film' }
const disabled = [false, false, false, false, false, true, false, false, true, false]

describe('discovery remote navigation', () => {
  it('follows the visible action rows and skips unavailable actions', () => {
    expect(discoveryRemoteFocus(1, 'down', disabled, 12, 0)).toBe(4)
    expect(discoveryRemoteFocus(4, 'right', disabled, 12, 0)).toBe(6)
    expect(discoveryRemoteFocus(7, 'right', disabled, 12, 0)).toBe(7)
    expect(discoveryRemoteFocus(7, 'down', disabled, 12, 0)).toBe(9)
    expect(discoveryRemoteFocus(9, 'down', disabled, 12, 2)).toBe(12)
    expect(discoveryRemoteFocus(12, 'up', disabled, 12, 2)).toBe(9)
  })
  it('crosses thumbnail groups and stops at the ends of the deck', () => {
    expect(discoveryRemoteFocus(14, 'right', disabled, 12, 4)).toBe(15)
    expect(discoveryRemoteFocus(15, 'left', disabled, 12, 5)).toBe(14)
    expect(discoveryRemoteFocus(10, 'left', disabled, 12, 0)).toBe(10)
    expect(discoveryRemoteFocus(21, 'right', disabled, 12, 11)).toBe(21)
  })
  it('keeps a short deck reachable when both paging controls are disabled', () => {
    const short = disabled.map((value, index) => index >= 8 || value)
    expect(discoveryRemoteFocus(7, 'down', short, 3, 1)).toBe(11)
    expect(discoveryRemoteFocus(11, 'up', short, 3, 1)).toBe(4)
    expect(discoveryRemoteFocus(7, 'down', short, 0, 0)).toBe(7)
  })
})

describe('TV discovery information', () => {
  it('labels movie and episode durations without inventing missing facts', () => {
    expect(discoveryMediaFacts(media, true)).toEqual(['Movie'])
    expect(discoveryMediaFacts({ ...media, releaseYear: 2024, runtimeMinutes: 121, contentRating: '12' }, true)).toEqual(['Movie', '2024', '121 min', '12'])
    expect(discoveryMediaFacts({ ...media, mediaKind: 'show', ref: { ...media.ref, type: 'tv' }, runtimeMinutes: 45 }, true)).toEqual(['Series', '45 min / episode'])
    expect(discoveryMediaFacts({ ...media, runtimeMinutes: 121 })).toEqual(['Movie'])
  })
  it('accepts valid clips even when their optional site field is missing', () => {
    expect(discoveryTrailer({ ...media, trailer: { id: 'aB12345_-89' } })).toBe('aB12345_-89')
    expect(discoveryTrailer({ ...media, trailer: { id: 'aB12345_-89', site: 'YouTube' } })).toBe('aB12345_-89')
    expect(discoveryTrailer({ ...media, trailer: { id: 'aB12345_-89', site: 'other' } })).toBe('')
    expect(discoveryTrailer({ ...media, trailer: { id: 'invalid' } })).toBe('')
  })
  it('renders a plain-text synopsis without markup or entity fragments', () => {
    expect(discoverySynopsis('<b>A &amp; B</b><br> A&nbsp;journey&#39;s end.')).toBe("A & B A journey's end.")
    expect(discoverySynopsis()).toBe('')
  })
})
