import type { CompanionMedia } from '../types'

export interface SearchSuggestion { label: string; kind: 'title' | 'genre' }

export function titleSuggestions(query: string, media: CompanionMedia[], genres: string[]): SearchSuggestion[] {
  const needle = query.trim().toLowerCase()
  const seen = new Set<string>()
  const titles = media.map(item => item.title).filter(title => {
    const key = title.trim().toLowerCase()
    if (!needle || !key.includes(needle) || seen.has(key)) return false
    seen.add(key)
    return true
  }).sort((a, b) => Number(b.toLowerCase().startsWith(needle)) - Number(a.toLowerCase().startsWith(needle))
    || a.length - b.length || a.localeCompare(b)).slice(0, 6)
  if (titles.length) return titles.map(label => ({ label, kind: 'title' }))
  return [...new Set(genres)].filter(label => !needle || label.toLowerCase().includes(needle))
    .slice(0, 6).map(label => ({ label, kind: 'genre' }))
}

export function searchIsLoading(query: string, settledQuery: string, pending: boolean): boolean {
  return Boolean(query.trim()) && (pending || query.trim().toLowerCase() !== settledQuery)
}
