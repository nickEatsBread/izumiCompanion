import { tvNow } from './tv-performance'

export type TvMotionAxis = 'x' | 'y'

interface TvMotionPosition {
  x: number
  y: number
}

interface ActiveTvMotion {
  element: HTMLElement
  axis: TvMotionAxis
  from: number
  to: number
  startedAt: number
  duration: number
}

interface LegacyAnimationWindow extends Window {
  webkitRequestAnimationFrame?: (callback: FrameRequestCallback) => number
  webkitCancelAnimationFrame?: (handle: number) => void
}

export interface TvMotionOptions {
  duration?: number
  immediate?: boolean
}

export interface TvMotionSettled {
  axis: TvMotionAxis
  duration: number
  distance: number
}

export function easeOutTvMotion(progress: number): number {
  const bounded = Math.max(0, Math.min(1, progress))
  return 1 - Math.pow(1 - bounded, 3)
}

export function tvMotionValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0) return to
  return from + (to - from) * easeOutTvMotion(elapsed / duration)
}

function requestTvFrame(callback: FrameRequestCallback): number {
  const legacyWindow = window as LegacyAnimationWindow
  const request = window.requestAnimationFrame || legacyWindow.webkitRequestAnimationFrame
  if (request) return request.call(window, callback)
  return window.setTimeout(() => callback(tvNow()), 16)
}

function cancelTvFrame(handle: number): void {
  const legacyWindow = window as LegacyAnimationWindow
  const cancel = window.cancelAnimationFrame || legacyWindow.webkitCancelAnimationFrame
  if (cancel) cancel.call(window, handle)
  else window.clearTimeout(handle)
}

function reducedMotionRequested(): boolean {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

function transformSupported(): boolean {
  const style = document.documentElement?.style as CSSStyleDeclaration & { webkitTransform?: string }
  return Boolean(style && ('transform' in style || 'webkitTransform' in style))
}

/**
 * One compositor-oriented scheduler for the Home surface. New D-pad targets replace an in-flight
 * target from its current visual position, so key repeat cannot build an animation queue.
 */
export class TvMotionController {
  private readonly active = new Map<HTMLElement, ActiveTvMotion>()
  private readonly positions = new WeakMap<HTMLElement, TvMotionPosition>()
  private readonly transformsAvailable = transformSupported()
  private frame: number | undefined

  constructor(private readonly onSettled?: (event: TvMotionSettled) => void) {}

  move(element: HTMLElement, axis: TvMotionAxis, target: number, options: TvMotionOptions = {}): void {
    const now = tvNow()
    const previous = this.active.get(element)
    const position = this.positions.get(element) ?? { x: 0, y: 0 }
    const stored = axis === 'x' ? position.x : position.y
    const from = previous
      ? tvMotionValue(previous.from, previous.to, now - previous.startedAt, previous.duration)
      : stored
    const to = Number.isFinite(target) ? Math.round(target) : from
    const duration = options.immediate || reducedMotionRequested()
      ? 0
      : Math.max(0, options.duration ?? (axis === 'x' ? 170 : 260))

    if (Math.abs(to - from) < .5 || duration === 0) {
      this.active.delete(element)
      this.apply(element, axis, to)
      this.release(element)
      if (!this.active.size && this.frame !== undefined) {
        cancelTvFrame(this.frame)
        this.frame = undefined
      }
      return
    }

    this.active.set(element, { element, axis, from, to, startedAt: now, duration })
    if (this.transformsAvailable) element.style.willChange = 'transform'
    this.schedule()
  }

  cancel(element: HTMLElement): void {
    this.active.delete(element)
    this.release(element)
    if (!this.active.size && this.frame !== undefined) {
      cancelTvFrame(this.frame)
      this.frame = undefined
    }
  }

  dispose(): void {
    if (this.frame !== undefined) cancelTvFrame(this.frame)
    this.frame = undefined
    this.active.forEach(({ element }) => this.release(element))
    this.active.clear()
  }

  private schedule(): void {
    if (this.frame !== undefined) return
    this.frame = requestTvFrame(this.tick)
  }

  private readonly tick = () => {
    this.frame = undefined
    const now = tvNow()
    const completed: ActiveTvMotion[] = []

    this.active.forEach((motion) => {
      const elapsed = now - motion.startedAt
      const value = tvMotionValue(motion.from, motion.to, elapsed, motion.duration)
      this.apply(motion.element, motion.axis, value)
      if (elapsed >= motion.duration) completed.push(motion)
    })

    completed.forEach((motion) => {
      if (this.active.get(motion.element) !== motion) return
      this.active.delete(motion.element)
      this.apply(motion.element, motion.axis, motion.to)
      this.release(motion.element)
      this.onSettled?.({
        axis: motion.axis,
        duration: Math.max(0, now - motion.startedAt),
        distance: motion.to - motion.from,
      })
    })

    if (this.active.size) this.schedule()
  }

  private apply(element: HTMLElement, axis: TvMotionAxis, value: number): void {
    const previous = this.positions.get(element) ?? { x: 0, y: 0 }
    const position = axis === 'x' ? { ...previous, x: value } : { ...previous, y: value }
    this.positions.set(element, position)
    if (this.transformsAvailable) {
      const transform = `translate3d(${position.x.toFixed(2)}px, ${position.y.toFixed(2)}px, 0)`
      element.style.transform = transform
      ;(element.style as CSSStyleDeclaration & { webkitTransform?: string }).webkitTransform = transform
    } else {
      element.style.left = `${Math.round(position.x)}px`
      element.style.top = `${Math.round(position.y)}px`
    }
  }

  private release(element: HTMLElement): void {
    if (this.transformsAvailable) element.style.willChange = ''
  }
}
