import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  finishHeroArtworkTransition,
  initialHeroArtwork,
  queueHeroArtwork,
  revealHeroArtwork,
} from './hero-artwork'

const homeScreenSource = readFileSync(new URL('../components/HomeScreen.tsx', import.meta.url), 'utf8')

describe('TV hero artwork handoff', () => {
  it('keeps replacement artwork hidden until it has loaded', () => {
    const first = initialHeroArtwork('one', 'one.jpg')
    const queued = queueHeroArtwork(first, 'two', 'two.jpg')

    expect(queued.current).toEqual({ key: 'two', image: 'two.jpg', visible: false })
    expect(queued.previous).toEqual({ key: 'one', image: 'one.jpg', visible: true })

    const revealed = revealHeroArtwork(queued, 'two')
    expect(revealed.current.visible).toBe(true)
    expect(finishHeroArtworkTransition(revealed, 'two')).toEqual({ current: revealed.current })
  })

  it('retains the last visible frame when focus changes again before an image loads', () => {
    const first = initialHeroArtwork('one', 'one.jpg')
    const secondPending = queueHeroArtwork(first, 'two', 'two.jpg')
    const thirdPending = queueHeroArtwork(secondPending, 'three', 'three.jpg')

    expect(thirdPending.current.visible).toBe(false)
    expect(thirdPending.previous).toEqual({ key: 'one', image: 'one.jpg', visible: true })
    expect(revealHeroArtwork(thirdPending, 'two')).toBe(thirdPending)
  })

  it('lets an artwork-free title retire the previous image cleanly', () => {
    const queued = queueHeroArtwork(initialHeroArtwork('one', 'one.jpg'), 'empty')

    expect(queued.current).toEqual({ key: 'empty', image: undefined, visible: true })
    expect(queued.previous?.visible).toBe(true)
  })

  it('does not invent generic billboard copy when a title has no description', () => {
    expect(homeScreenSource).toContain('{hero.description && <p class="hero-description">{hero.description}</p>}')
    expect(homeScreenSource).not.toContain('Pick up where you left off, or find something new to watch.')
  })
})
