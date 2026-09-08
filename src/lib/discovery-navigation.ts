import type { CompanionMedia } from '../types'

export const DISCOVERY_TILES = 5
export const DISCOVERY_TILE_FOCUS = 10

/** Focus rows follow the visible action rows, paging controls, then the title strip. */
export function discoveryRemoteFocus(focus: number, direction: string, disabled: boolean[], count: number, selected: number): number {
  const available = (row: number[], preferred: number) => row.filter(index => !disabled[index])
    .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0]
  const row = focus < 4 ? [0, 1, 2, 3] : focus < 8 ? [4, 5, 6, 7] : [8, 9]
  if (focus >= DISCOVERY_TILE_FOCUS) {
    if (direction === 'left') return Math.max(DISCOVERY_TILE_FOCUS, focus - 1)
    if (direction === 'right') return Math.min(DISCOVERY_TILE_FOCUS + count - 1, focus + 1)
    if (direction === 'up') return available([8, 9], 8) ?? available([4, 5, 6, 7], 4) ?? focus
    return focus
  }
  if (direction === 'left' || direction === 'right') {
    const step = direction === 'left' ? -1 : 1
    for (let next = focus + step; row.includes(next); next += step) if (!disabled[next]) return next
  }
  if (direction === 'up') {
    if (focus >= 8) return available([4, 5, 6, 7], focus === 8 ? 4 : 7) ?? focus
    if (focus >= 4) return available([0, 1, 2, 3], focus - 4) ?? focus
  }
  if (direction === 'down') {
    if (focus < 4) return available([4, 5, 6, 7], focus + 4) ?? focus
    if (focus < 8) {
      const paging = available([8, 9], focus < 6 ? 8 : 9)
      if (paging !== undefined) return paging
    }
    if (count) return DISCOVERY_TILE_FOCUS + Math.max(0, Math.min(count - 1, selected))
  }
  return focus
}

export function discoveryMediaFacts(media: CompanionMedia, detailed = false): string[] {
  const movie = media.mediaKind === 'movie' || media.ref.type === 'movie'
  const kind = movie ? 'Movie' : media.ref.type === 'anime' ? 'Anime series' : 'Series'
  const facts = [kind]
  if (media.releaseYear) facts.push(String(media.releaseYear))
  if (detailed) {
    const minutes = media.runtimeMinutes
    if (minutes && Number.isFinite(minutes) && minutes > 0) facts.push(`${Math.round(minutes)} min${movie ? '' : ' / episode'}`)
    if (media.contentRating) facts.push(media.contentRating)
  }
  return facts
}

export function discoveryTrailer(media?: CompanionMedia): string {
  const clip = media?.trailer
  if (!clip || (clip.site && clip.site.toLowerCase() !== 'youtube')) return ''
  return /^[\w-]{11}$/.test(clip.id) ? clip.id : ''
}

export function discoverySynopsis(value?: string): string {
  return (value || '').replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}
