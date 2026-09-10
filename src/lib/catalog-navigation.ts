import type { CompanionCatalogOption, ScreenName } from '../types'

/** Only an intentional catalogue navigation may replace an established screen. */
export function mayNavigateForSnapshot(screen: ScreenName, hasPlayback: boolean, requested: boolean): boolean {
  if (hasPlayback || ['loading', 'player', 'postplay', 'error'].includes(screen)) return false
  return requested || screen === 'ready'
}

export function validCatalogOptions(value: unknown, depth = 0): CompanionCatalogOption[] {
  if (!Array.isArray(value) || depth > 2) return []
  return value.slice(0, 200).flatMap(item => {
    if (!item || typeof item.screen !== 'string' || item.screen.length > 40 || typeof item.label !== 'string') return []
    const children = item.children === undefined ? undefined : validCatalogOptions(item.children, depth + 1)
    if (item.children && !children?.length) return []
    let cover: string | undefined
    try { const url = new URL(item.cover); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) cover = url.href } catch { /* optional artwork */ }
    return [{ screen: item.screen, label: item.label.slice(0, 240), children, cover,
      emoji: typeof item.emoji === 'string' ? item.emoji.slice(0, 16) : undefined,
      shape: ['poster', 'square', 'landscape'].includes(item.shape) ? item.shape : undefined,
      description: typeof item.description === 'string' ? item.description.slice(0, 240) : undefined }]
  })
}

export function mergeAccountOptions(current: CompanionCatalogOption[], incoming: CompanionCatalogOption[]) {
  return [...current.filter(option => !/^(account-|nuvio-collections$|local-collections$)/.test(option.screen)), ...validCatalogOptions(incoming)]
}

export function catalogLevel(root: CompanionCatalogOption[], trail: CompanionCatalogOption[]): CompanionCatalogOption[] {
  return trail.length ? [{ screen: '__back', label: 'Back to ' + (trail.length > 1 ? trail[trail.length - 2].label : 'catalogues') }, ...(trail[trail.length - 1].children || [])] : root
}
