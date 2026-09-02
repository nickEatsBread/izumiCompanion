export interface TvPerformanceEntry {
  name: string
  at: number
  duration?: number
  detail?: string
}

const entries: TvPerformanceEntry[] = []
const maximumEntries = 240
let lastRemoteInput: number | undefined

function profileRequested(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).has('profile')
      || window.localStorage.getItem('izumi:tv-profile') === '1'
  } catch {
    return false
  }
}

const enabled = profileRequested()

/** Tizen 2.3 can lack performance.now(), while Date.now() is available on the legacy floor. */
export function tvNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
  return Date.now()
}

function push(entry: TvPerformanceEntry): void {
  if (!enabled) return
  entries.push(entry)
  if (entries.length > maximumEntries) entries.splice(0, entries.length - maximumEntries)
}

export function markRemoteInput(action: string): void {
  if (!enabled) return
  lastRemoteInput = tvNow()
  push({ name: 'remote-input', at: lastRemoteInput, detail: action })
}

export function markFocusApplied(focus: string): void {
  if (!enabled) return
  const at = tvNow()
  push({
    name: 'focus-applied',
    at,
    duration: lastRemoteInput === undefined ? undefined : at - lastRemoteInput,
    detail: focus,
  })
  lastRemoteInput = undefined
}

export function markScrollSettled(axis: 'scrollLeft' | 'scrollTop', startedAt: number, distance: number): void {
  if (!enabled) return
  const at = tvNow()
  push({ name: 'scroll-settled', at, duration: at - startedAt, detail: `${axis}:${Math.round(distance)}px` })
}

export function markMotionSettled(axis: 'x' | 'y', duration: number, distance: number): void {
  if (!enabled) return
  push({
    name: 'motion-settled',
    at: tvNow(),
    duration,
    detail: `${axis}:${Math.round(distance)}px`,
  })
}

if (enabled && typeof window !== 'undefined') {
  window.__IZUMI_TV_PROFILE__ = {
    read: () => entries.slice(),
    clear: () => {
      entries.length = 0
      lastRemoteInput = undefined
    },
  }
}
