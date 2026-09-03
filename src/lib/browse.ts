import type { CompanionHomeRow, CompanionHomeSnapshot, CompanionMedia } from '../types'
import { uniqueMedia } from './catalog'

const CATEGORY_ORDER = [
  'Dramas', 'Romance', 'Book Adaptations', 'Emmys', 'Reality TV', 'Comedies',
  'Crime', 'Documentaries', 'Stand-Up', 'Thrillers', 'Fantasy', 'Action & Adventure',
  'Kids & Family', 'Anime', 'WWE & Wrestling', 'Culture', 'Horror', 'Mystery',
  'Science Fiction', 'Animation',
]

function categoryName(raw: string): string {
  const value = raw.trim()
  const normalized = value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const aliases: Record<string, string> = {
    drama: 'Dramas', romance: 'Romance', comedy: 'Comedies', documentary: 'Documentaries',
    'stand up': 'Stand-Up', 'stand up comedy': 'Stand-Up', thriller: 'Thrillers', fantasy: 'Fantasy',
    action: 'Action & Adventure', adventure: 'Action & Adventure', 'action & adventure': 'Action & Adventure',
    family: 'Kids & Family', kids: 'Kids & Family', children: 'Kids & Family',
    crime: 'Crime', reality: 'Reality TV', 'reality tv': 'Reality TV', horror: 'Horror',
    mystery: 'Mystery', 'science fiction': 'Science Fiction', 'sci fi': 'Science Fiction',
    'sci fi & fantasy': 'Science Fiction', animation: 'Animation',
    anime: 'Anime', wrestling: 'WWE & Wrestling', wwe: 'WWE & Wrestling',
    culture: 'Culture', 'young adult': 'For YA Fans', astrology: 'Astrology',
    'book adaptation': 'Book Adaptations', 'book adaptations': 'Book Adaptations',
    'based on a novel': 'Book Adaptations',
  }
  return aliases[normalized] ?? value
}

function identity(media: CompanionMedia): string {
  return `${media.ref.provider}:${media.ref.type}:${media.ref.id}`
}

function sourceBalanced(items: CompanionMedia[]): CompanionMedia[] {
  const providers = new Map<string, CompanionMedia[]>()
  for (const item of items) providers.set(item.ref.provider, [...(providers.get(item.ref.provider) ?? []), item])
  const buckets = [...providers.values()]
  const output: CompanionMedia[] = []
  const maximum = Math.max(0, ...buckets.map((bucket) => bucket.length))
  for (let index = 0; index < maximum; index += 1) {
    for (const bucket of buckets) if (bucket[index]) output.push(bucket[index])
  }
  return output
}

function actualCategories(media: CompanionMedia): string[] {
  const categories = (media.genres ?? []).map(categoryName)
  if (media.ref.type === 'anime') categories.push('Anime')
  if (media.achievements?.some((achievement) => /\bemmys?\b/i.test(achievement.label))) categories.push('Emmys')
  return [...new Set(categories.filter(Boolean))]
}

/** Build Browse entirely from facts supplied by enabled catalogues. A category only exists when
 * at least two real titles support it; event/editorial shelves are never guessed from a synopsis. */
export function browseCategoryRows(snapshot: CompanionHomeSnapshot, minimumItems = 2): CompanionHomeRow[] {
  const all = uniqueMedia([
    ...(snapshot.views?.search ?? []),
    ...snapshot.rows.reduce<CompanionMedia[]>((items, row) => items.concat(row.items), []),
  ])
  const categories = new Map<string, CompanionMedia[]>()
  for (const item of all) {
    for (const category of actualCategories(item)) {
      const items = categories.get(category) ?? []
      if (!items.some((candidate) => identity(candidate) === identity(item))) items.push(item)
      categories.set(category, items)
    }
  }
  const order = (title: string) => {
    const index = CATEGORY_ORDER.indexOf(title)
    return index < 0 ? CATEGORY_ORDER.length : index
  }
  const categoryRows = [...categories]
    .filter(([, items]) => items.length >= minimumItems)
    .sort(([left, leftItems], [right, rightItems]) => (
      order(left) - order(right) || rightItems.length - leftItems.length || left.localeCompare(right)
    ))
    .slice(0, 14)
    .map(([title, items]): CompanionHomeRow => ({
      id: `browse:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      title,
      kind: 'catalog',
      items: sourceBalanced(items).slice(0, 30),
    }))

  if (categoryRows.length >= 3) return categoryRows
  const categoryTitles = new Set(categoryRows.map((row) => row.title.toLowerCase()))
  const authoredFallbacks = snapshot.rows.filter((row) => row.kind === 'catalog'
    && !categoryTitles.has(row.title.toLowerCase()))
  return [...categoryRows, ...authoredFallbacks].slice(0, 12)
}
