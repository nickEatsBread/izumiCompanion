export interface LayoutOrder { order: string[]; hidden: string[] }
export type ScreenLayout = Record<string, LayoutOrder>
export const layoutStorageKey = (profile: string) => `izumi.companion.screen-layout.${profile}`

export function readScreenLayout(profile: string): ScreenLayout {
  try {
    const value = JSON.parse(localStorage.getItem(layoutStorageKey(profile)) || '{}')
    const result: ScreenLayout = {}
    for (const key of Object.keys(value).slice(0, 100)) {
      const clean = (items: unknown): string[] => Array.isArray(items)
        ? [...new Set(items.filter((item): item is string => typeof item === 'string' && item.length <= 240))].slice(0, 200) : []
      result[key] = { order: clean(value[key]?.order), hidden: clean(value[key]?.hidden) }
    }
    return result
  } catch { return {} }
}

export function writeScreenLayout(profile: string, layout: ScreenLayout): boolean {
  try { localStorage.setItem(layoutStorageKey(profile), JSON.stringify(layout)); return true } catch { return false }
}

export function orderedLayoutItems<T>(items: T[], layout: LayoutOrder | undefined, id: (item: T) => string, includeHidden = false): T[] {
  if (!layout) return items
  const order = new Map(layout.order.map((key, index) => [key, index]))
  const sorted = items.map((item, index) => ({ item, index })).sort((a, b) =>
    (order.get(id(a.item)) ?? 1000 + a.index) - (order.get(id(b.item)) ?? 1000 + b.index)).map(entry => entry.item)
  const visible = includeHidden ? sorted : sorted.filter(item => !layout.hidden.includes(id(item)))
  // A stale preference must never leave a newly refreshed catalogue inaccessible.
  return visible.length ? visible : sorted.slice(0, 1)
}

export function editLayout(items: { id: string }[], layout: LayoutOrder | undefined, selectedId: string, action: 'toggle' | 'up' | 'down'): LayoutOrder {
  const ordered = orderedLayoutItems(items, layout, item => item.id, true).map(item => item.id)
  const hidden = (layout?.hidden ?? []).slice()
  const index = ordered.indexOf(selectedId)
  if (index < 0) return { order: ordered, hidden }
  if (action === 'toggle') {
    const existing = hidden.indexOf(selectedId)
    if (existing >= 0) hidden.splice(existing, 1)
    else if (ordered.filter(id => !hidden.includes(id)).length > 1) hidden.push(selectedId)
  } else {
    const next = Math.max(0, Math.min(ordered.length - 1, index + (action === 'up' ? -1 : 1)))
    ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
  }
  return { order: ordered, hidden }
}
