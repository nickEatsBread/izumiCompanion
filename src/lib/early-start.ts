// Progressive source results arrive one add-on batch at a time. Waiting for the complete ranked
// list means waiting for the slowest add-on and every release the Worker prepares in the
// background, so playback should start once the leading candidate has stopped changing for a
// moment, while discovery continues behind it and keeps filling the picker.

export const EARLY_START_GRACE_MS = 1_500
export const EARLY_START_MAX_WAIT_MS = 4_500

export interface EarlyStartState {
  /** When the first usable candidate was observed. */
  firstAt?: number
  /** The candidate that currently leads the ranking. */
  topId?: string
  /** When that candidate took the lead. */
  topSince?: number
}

/** Record the current leader; the settle timer restarts whenever the leader changes. */
export function observeEarlyStart(state: EarlyStartState, topId: string | undefined, now: number): EarlyStartState {
  if (!topId) return state
  if (state.topId === topId && state.firstAt != null) return state
  return { firstAt: state.firstAt ?? now, topId, topSince: now }
}

/** Milliseconds until playback may start, or undefined when nothing has been observed yet. */
export function earlyStartDelay(state: EarlyStartState, now: number): number | undefined {
  if (state.firstAt == null || state.topSince == null) return undefined
  const settled = state.topSince + EARLY_START_GRACE_MS
  const latest = state.firstAt + EARLY_START_MAX_WAIT_MS
  return Math.max(0, Math.min(settled, latest) - now)
}
