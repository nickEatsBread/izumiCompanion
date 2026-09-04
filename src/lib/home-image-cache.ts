import type { CompanionMedia } from '../types'

export type HomeImageKind = 'title' | 'artwork'

// Title art is comparatively small and is the first thing a viewer reads after a D-pad move.
// Artwork is commonly decoded at 1080p, so its decoded cache is deliberately much smaller.
const CACHE_LIMITS: Record<HomeImageKind, number> = { title: 24, artwork: 6 }
const FAILURE_LIMIT = 32
const LOAD_TIMEOUT_MS = 4_000

const retained: Record<HomeImageKind, Map<string, HTMLImageElement>> = {
  title: new Map(),
  artwork: new Map(),
}
const inflight = new Map<string, Promise<boolean>>()
const failed = new Map<string, true>()

function cacheKey(source: string, kind: HomeImageKind): string {
  return `${kind}:${source}`
}

function touch(kind: HomeImageKind, source: string): void {
  const cache = retained[kind]
  const image = cache.get(source)
  if (!image) return
  cache.delete(source)
  cache.set(source, image)
}

function retain(kind: HomeImageKind, source: string, image: HTMLImageElement): void {
  const cache = retained[kind]
  cache.delete(source)
  cache.set(source, image)
  while (cache.size > CACHE_LIMITS[kind]) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) break
    cache.delete(oldest)
  }
}

function rememberFailure(key: string): void {
  failed.delete(key)
  failed.set(key, true)
  while (failed.size > FAILURE_LIMIT) {
    const oldest = failed.keys().next().value as string | undefined
    if (!oldest) break
    failed.delete(oldest)
  }
}

export function isHomeImageReady(source?: string, kind: HomeImageKind = 'title'): boolean {
  if (!source || !retained[kind].has(source)) return false
  touch(kind, source)
  return true
}

export function isHomeImageFailed(source?: string, kind: HomeImageKind = 'title'): boolean {
  return Boolean(source && failed.has(cacheKey(source, kind)))
}

/** Keep the actual loaded image alive, not merely its URL. Older Tizen WebKit/Chromium builds can
 * evict a decoded bitmap immediately after a detached Image becomes unreachable, which turns a
 * supposedly preloaded focus transition into a grey frame and another decode. */
export function preloadHomeImage(source?: string, kind: HomeImageKind = 'title'): Promise<boolean> {
  if (!source || typeof Image === 'undefined') return Promise.resolve(false)
  const key = cacheKey(source, kind)
  if (failed.has(key)) return Promise.resolve(false)
  if (retained[kind].has(source)) {
    touch(kind, source)
    return Promise.resolve(true)
  }
  const pending = inflight.get(key)
  if (pending) return pending

  const request = new Promise<boolean>((resolve) => {
    const image = new Image()
    image.decoding = 'async'
    let settled = false
    const finish = (loaded: boolean, permanentFailure = false) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      image.onload = null
      image.onerror = null
      inflight.delete(key)
      if (loaded) retain(kind, source, image)
      else if (permanentFailure) rememberFailure(key)
      resolve(loaded)
    }
    // A slow image is not a broken image. Allow a later visit to retry after the network settles.
    const timeout = setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    image.onload = () => finish(true)
    image.onerror = () => finish(false, true)
    image.src = source
  })
  inflight.set(key, request)
  return request
}

export function markHomeImageFailed(source?: string, kind: HomeImageKind = 'title'): void {
  if (!source) return
  retained[kind].delete(source)
  rememberFailure(cacheKey(source, kind))
}

export function focusArtworkSources(media: CompanionMedia, episodeCard: boolean): string[] {
  return Array.from(new Set([
    episodeCard ? media.episodeImage : media.backdrop,
    media.backdrop,
    media.episodeImage,
    media.poster,
  ].filter((value): value is string => Boolean(value))))
}

/** Metadata/title art is warmed for the whole navigation window. Large artwork is opt-in so a
 * six-step look-ahead cannot decode ten full-resolution backdrops and exhaust an older TV. */
export function preloadHomeMedia(media: CompanionMedia, episodeCard: boolean, includeArtwork = false): void {
  void preloadHomeImage(media.logoImage, 'title')
  if (includeArtwork) void preloadHomeImage(focusArtworkSources(media, episodeCard)[0], 'artwork')
}

export function homeImageCacheStats(): Record<HomeImageKind, number> {
  return { title: retained.title.size, artwork: retained.artwork.size }
}
