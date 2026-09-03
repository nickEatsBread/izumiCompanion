import type { CompanionCatalogOption, CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia } from '../types'

export const MERGED_CATALOG_SCREEN = 'merged'

export type CatalogMediaDestination = 'details' | 'series'

/** Catalogue tiles always open a title page. Continue Watching owns the only shelf-level
 * direct-play shortcut, while provider mediaKind corrects inconsistent legacy ref types. */
export function catalogMediaDestination(media: CompanionMedia): CatalogMediaDestination {
  if (media.mediaKind === 'show') return 'series'
  if (media.mediaKind === 'movie') return 'details'
  return media.ref.type === 'movie' ? 'details' : 'series'
}

function mediaKey(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

function mergePresentationMedia(media: CompanionMedia, details: CompanionMedia): CompanionMedia {
  if (mediaKey(media) !== mediaKey(details)) return media
  return {
    ...media,
    title: details.title || media.title,
    subtitle: details.subtitle ?? media.subtitle,
    description: details.description ?? media.description,
    contentRating: details.contentRating ?? media.contentRating,
    mediaKind: details.mediaKind ?? media.mediaKind,
    genres: details.genres?.length ? details.genres : media.genres,
    releaseYear: details.releaseYear ?? media.releaseYear,
    runtimeMinutes: details.runtimeMinutes ?? media.runtimeMinutes,
    ratings: details.ratings?.length ? details.ratings : media.ratings,
    poster: details.poster || media.poster,
    backdrop: details.backdrop || media.backdrop,
    logoImage: details.logoImage || media.logoImage,
    titleArtSettled: true,
    trailer: details.trailer ?? media.trailer,
    seasonEpisodeCounts: details.seasonEpisodeCounts?.length ? details.seasonEpisodeCounts : media.seasonEpisodeCounts,
    seasonLabels: details.seasonLabels?.length ? details.seasonLabels : media.seasonLabels,
  }
}

/** Cache presentation metadata returned for one focused title into every Home projection that
 * contains it. Progress and shelf placement remain owned by each projection. */
export function mergeHomeMediaDetails(snapshot: CompanionHomeSnapshot, details: CompanionMedia): CompanionHomeSnapshot {
  let changed = false
  const merge = (media: CompanionMedia): CompanionMedia => {
    const next = mergePresentationMedia(media, details)
    if (next !== media) changed = true
    return next
  }
  const views = snapshot.views ? {
    search: snapshot.views.search?.map(merge),
    trending: snapshot.views.trending?.map(merge),
    series: snapshot.views.series?.map(merge),
    movies: snapshot.views.movies?.map(merge),
    myList: snapshot.views.myList?.map(merge),
  } : undefined
  const next = {
    ...snapshot,
    hero: snapshot.hero ? merge(snapshot.hero) : undefined,
    rows: snapshot.rows.map((row) => ({ ...row, items: row.items.map(merge) })),
    ...(views ? { views } : {}),
  }
  return changed ? next : snapshot
}

function rankedRow(row: CompanionHomeRow): boolean {
  return row.presentation === 'top-10' || /trending|popular|top\s*10|top rated/i.test(`${row.id} ${row.title}`)
}

/** Continue Watching is always the first downward destination; the strongest ranked row follows. */
export function orderedHomeRows(rows: CompanionHomeRow[]): CompanionHomeRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const priority = (row: CompanionHomeRow) => row.kind === 'continue' ? 0 : rankedRow(row) ? 1 : 2
      return priority(left.row) - priority(right.row) || left.index - right.index
    })
    .map(({ row }) => row)
}

/** Build a small featured rail from provider-authored hero/trending data without extending protocol v1. */
export function homeHeroItems(snapshot: CompanionHomeSnapshot, limit = 5): CompanionMedia[] {
  const ranked = snapshot.views?.trending?.length
    ? snapshot.views.trending
    : snapshot.rows.filter(rankedRow).reduce<CompanionMedia[]>((items, row) => items.concat(row.items), [])
  const candidates = [snapshot.hero, ...ranked].filter((item): item is CompanionMedia => Boolean(item))
  const seen = new Set<string>()
  return candidates.filter((item) => {
    const key = mediaKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, Math.max(1, limit))
}

/** Browse is a first-class view of the merged provider catalogue. Older linked clients may omit
 * catalogue options, so keep the protocol's stable merged screen id as a safe fallback. */
export function mergedCatalogOption(snapshot: CompanionHomeSnapshot): CompanionCatalogOption {
  return snapshot.catalog.options?.find((option) => (
    option.screen.trim().toLowerCase() === MERGED_CATALOG_SCREEN
    || option.label.trim().toLowerCase() === MERGED_CATALOG_SCREEN
  )) ?? { screen: MERGED_CATALOG_SCREEN, label: 'Merged' }
}

export function isMergedCatalog(snapshot: CompanionHomeSnapshot): boolean {
  return snapshot.catalog.screen.trim().toLowerCase() === MERGED_CATALOG_SCREEN
    || snapshot.catalog.label.trim().toLowerCase() === MERGED_CATALOG_SCREEN
}

export function wrappedHeroIndex(current: number, direction: -1 | 1, length: number): number {
  if (length <= 1) return 0
  return (Math.max(0, current) + direction + length) % length
}

/** Render a cyclic slice of a shelf so wrapping its focus never exposes a finite-strip seam. */
export function cyclicRailIndexes(length: number, start: number, count: number): number[] {
  const safeLength = Math.max(0, Math.floor(length))
  const safeCount = Math.min(safeLength, Math.max(0, Math.floor(count)))
  if (!safeLength || !safeCount) return []
  const safeStart = ((Math.floor(start) % safeLength) + safeLength) % safeLength
  return Array.from({ length: safeCount }, (_, offset) => (safeStart + offset) % safeLength)
}

/** Each rail owns its horizontal position. Entering an unseen rail starts at its first item
 * instead of copying a potentially very large index from the rail above it. */
export function rememberedHomeRowIndex(
  row: CompanionHomeRow | undefined,
  remembered: Record<string, number>,
): number {
  if (!row?.items.length) return 0
  const index = remembered[row.id]
  if (!Number.isFinite(index)) return 0
  return Math.max(0, Math.min(row.items.length - 1, Math.floor(index)))
}
