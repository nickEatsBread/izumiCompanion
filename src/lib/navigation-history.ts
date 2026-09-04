export const NAVIGATION_HISTORY_LIMIT = 8

export function pushNavigationEntry<T>(history: readonly T[], entry: T, limit = NAVIGATION_HISTORY_LIMIT): T[] {
  const safeLimit = Math.max(1, Math.floor(limit))
  return [...history, entry].slice(-safeLimit)
}

export function popNavigationEntry<T>(history: readonly T[]): { entry?: T; history: T[] } {
  if (!history.length) return { history: [] }
  return {
    entry: history[history.length - 1],
    history: history.slice(0, -1),
  }
}
