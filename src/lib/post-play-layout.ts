import type { RemoteAction } from './remote'

/** AVPlay's video plane and its HTML hit target must use the same physical-TV rectangle. */
export const POST_PLAY_VIDEO_RECT = { x: 1260, y: 64, width: 592, height: 333 }

export function nextPostPlayFocus(focus: number, action: RemoteAction, stage: 'rating' | 'recommendations', hasItems: boolean, mini: boolean): number {
  if (stage === 'rating') {
    if (action === 'up' && mini) return 0
    if (action === 'down' && focus === 0) return 1
    if (action === 'left') return focus === 0 ? 2 : 1
    if (action === 'right') return focus === 1 ? 2 : mini ? 0 : 2
    return focus
  }
  if (action === 'up') return focus === 2 || focus === 5 ? 1 : mini ? 0 : focus
  if (action === 'down') return focus === 0 ? 1 : focus === 1 || focus === 3 || focus === 4 ? 5 : focus
  if (action === 'left') return focus === 0 ? hasItems ? 4 : 2 : focus === 4 ? 3 : focus === 3 ? 1 : focus === 2 ? 5 : focus
  if (action === 'right') return focus === 1 ? hasItems ? 3 : 2 : focus === 3 ? 4 : focus === 4 && mini ? 0 : focus === 5 ? 2 : focus
  return focus
}
