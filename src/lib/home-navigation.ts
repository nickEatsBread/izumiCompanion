import type { CompanionCatalogOption, CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia } from '../types'

export const MERGED_CATALOG_SCREEN = 'merged'

function mediaKey(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
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
