import { afterEach, describe, expect, it, vi } from 'vitest'

interface MockImage {
  onload: (() => void) | null
  onerror: (() => void) | null
  decoding: string
  src: string
}

const images: MockImage[] = []

class TestImage implements MockImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  decoding = 'auto'
  src = ''

  constructor() {
    images.push(this)
  }
}

afterEach(() => {
  images.splice(0)
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('bounded TV home image cache', () => {
  it('deduplicates inflight loads and retains a decoded title image', async () => {
    vi.stubGlobal('Image', TestImage)
    const cache = await import('./home-image-cache')
    const first = cache.preloadHomeImage('logo.png', 'title')
    const duplicate = cache.preloadHomeImage('logo.png', 'title')

    expect(images).toHaveLength(1)
    expect(duplicate).toBe(first)
    images[0].onload?.()

    await expect(first).resolves.toBe(true)
    expect(cache.isHomeImageReady('logo.png', 'title')).toBe(true)
    await cache.preloadHomeImage('logo.png', 'title')
    expect(images).toHaveLength(1)
  })

  it('does not expose a downloaded title image until its bitmap decode completes', async () => {
    let releaseDecode: (() => void) | undefined
    class DecodingImage extends TestImage {
      decode(): Promise<void> {
        return new Promise((resolve) => { releaseDecode = resolve })
      }
    }
    vi.stubGlobal('Image', DecodingImage)
    const cache = await import('./home-image-cache')
    const request = cache.preloadHomeImage('decoded-logo.png', 'title')

    images[0].onload?.()
    expect(cache.isHomeImageReady('decoded-logo.png', 'title')).toBe(false)
    releaseDecode?.()

    await expect(request).resolves.toBe(true)
    expect(cache.isHomeImageReady('decoded-logo.png', 'title')).toBe(true)
  })

  it('keeps title and full-resolution artwork in separate memory budgets', async () => {
    vi.stubGlobal('Image', TestImage)
    const cache = await import('./home-image-cache')

    for (let index = 0; index < 25; index += 1) {
      const request = cache.preloadHomeImage(`logo-${index}.png`, 'title')
      images[images.length - 1]?.onload?.()
      await request
    }
    for (let index = 0; index < 7; index += 1) {
      const request = cache.preloadHomeImage(`art-${index}.jpg`, 'artwork')
      images[images.length - 1]?.onload?.()
      await request
    }

    expect(cache.homeImageCacheStats()).toEqual({ title: 24, artwork: 6 })
    expect(cache.isHomeImageReady('logo-0.png', 'title')).toBe(false)
    expect(cache.isHomeImageReady('logo-24.png', 'title')).toBe(true)
    expect(cache.isHomeImageReady('art-0.jpg', 'artwork')).toBe(false)
    expect(cache.isHomeImageReady('art-6.jpg', 'artwork')).toBe(true)
  })

  it('falls back after a real image error without repeatedly requesting the broken URL', async () => {
    vi.stubGlobal('Image', TestImage)
    const cache = await import('./home-image-cache')
    const request = cache.preloadHomeImage('missing.png', 'title')
    images[0].onerror?.()

    await expect(request).resolves.toBe(false)
    expect(cache.isHomeImageFailed('missing.png', 'title')).toBe(true)
    await expect(cache.preloadHomeImage('missing.png', 'title')).resolves.toBe(false)
    expect(images).toHaveLength(1)
  })
})
