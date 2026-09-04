import type { CompanionCatalogOption, CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia, FocusLocation } from '../types'

export const MERGED_CATALOG_SCREEN = 'merged'

export type CatalogMediaDestination = 'details' | 'series'
export type HomeMediaKind = 'movie' | 'show'

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

/** Return detail requests in remote-navigation priority order. Ten nearby destinations cover five
 * horizontal moves plus both vertical landing areas without retaining an entire catalogue on a
 * memory-constrained TV. Horizontal look-ahead comes first because it is the most frequent and
 * latency-sensitive remote action. */
export function homeDetailPrefetchTargets(
  rows: CompanionHomeRow[],
  focus: FocusLocation,
  remembered: Record<string, number>,
): CompanionMedia[] {
  const targets: CompanionMedia[] = []
  const seen = new Set<string>()
  const add = (media?: CompanionMedia) => {
    if (!media) return
    const key = mediaKey(media)
    if (seen.has(key)) return
    seen.add(key)
    targets.push(media)
  }
  const addRowDestination = (rowIndex: number, includeNext = false) => {
    const row = rows[rowIndex]
    const index = rememberedHomeRowIndex(row, remembered)
    add(row?.items[index])
    if (includeNext && row?.items.length && row.items.length > 1) add(row.items[(index + 1) % row.items.length])
  }

  if (focus.zone === 'row') {
    const row = rows[focus.row]
    const length = row?.items.length ?? 0
    if (!length) return targets
    add(row.items[focus.index])
    for (let offset = 1; offset <= Math.min(5, length - 1); offset += 1) add(row.items[(focus.index + offset) % length])
    addRowDestination(focus.row + 1, true)
    addRowDestination(focus.row - 1, true)
    return targets.slice(0, 10)
  }

  // Hero/nav focus can enter the first shelf next, so prepare its horizontal look-ahead and both
  // subsequent vertical landing areas before the user moves.
  const firstRow = rows[0]
  const firstIndex = rememberedHomeRowIndex(firstRow, remembered)
  if (firstRow?.items.length) {
    add(firstRow.items[firstIndex])
    for (let offset = 1; offset <= Math.min(5, firstRow.items.length - 1); offset += 1) {
      add(firstRow.items[(firstIndex + offset) % firstRow.items.length])
    }
  }
  addRowDestination(1, true)
  addRowDestination(2, true)
  return targets.slice(0, 10)
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
  const merge = (media: CompanionMedia): CompanionMedia => {
    return mergePresentationMedia(media, details)
  }
  const mergeItems = (items: CompanionMedia[] | undefined): CompanionMedia[] | undefined => {
    if (!items) return undefined
    const next = items.map(merge)
    return next.some((item, index) => item !== items[index]) ? next : items
  }
  const nextRows = snapshot.rows.map((row) => {
    const items = mergeItems(row.items)!
    return items === row.items ? row : { ...row, items }
  })
  const rows = nextRows.some((row, index) => row !== snapshot.rows[index]) ? nextRows : snapshot.rows
  const hero = snapshot.hero ? merge(snapshot.hero) : undefined
  let views = snapshot.views
  if (snapshot.views) {
    const search = mergeItems(snapshot.views.search)
    const trending = mergeItems(snapshot.views.trending)
    const series = mergeItems(snapshot.views.series)
    const movies = mergeItems(snapshot.views.movies)
    const myList = mergeItems(snapshot.views.myList)
    if (search !== snapshot.views.search || trending !== snapshot.views.trending
      || series !== snapshot.views.series || movies !== snapshot.views.movies || myList !== snapshot.views.myList) {
      views = { search, trending, series, movies, myList }
    }
  }
  if (hero === snapshot.hero && rows === snapshot.rows && views === snapshot.views) return snapshot
  return {
    ...snapshot,
    hero,
    rows,
    ...(views ? { views } : {}),
  }
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

export function homeMediaMatchesKind(media: CompanionMedia, kind: HomeMediaKind): boolean {
  if (media.mediaKind) return media.mediaKind === kind
  if (kind === 'movie') return media.ref.type === 'movie'
  return ['anime', 'series', 'tv', 'show'].includes(media.ref.type.toLowerCase())
}

/** Project the normal Home experience onto one media type without duplicating rows or protocol
 * data. Empty shelves disappear and the first matching title becomes the featured hero. */
export function homeSnapshotForKind(snapshot: CompanionHomeSnapshot, kind: HomeMediaKind): CompanionHomeSnapshot {
  const filter = (items: CompanionMedia[] | undefined) => items?.filter((item) => homeMediaMatchesKind(item, kind))
  const rows = snapshot.rows
    .map((row) => ({ ...row, items: row.items.filter((item) => homeMediaMatchesKind(item, kind)) }))
    .filter((row) => row.items.length > 0)
  const hero = snapshot.hero && homeMediaMatchesKind(snapshot.hero, kind)
    ? snapshot.hero
    : rows[0]?.items[0]
  const views = snapshot.views ? {
    search: filter(snapshot.views.search),
    trending: filter(snapshot.views.trending),
    series: filter(snapshot.views.series),
    movies: filter(snapshot.views.movies),
    myList: filter(snapshot.views.myList),
  } : undefined
  return { ...snapshot, hero, rows, ...(views ? { views } : {}) }
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
