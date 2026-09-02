import { describe, expect, it } from 'vitest'
import { gridItemVisible, gridWindow, horizontalSpacerDimensions, linearWindow } from './windowing'

describe('TV render windows', () => {
  it('bounds a linear window at either end of a long episode list', () => {
    expect(linearWindow(100, 0, 4)).toEqual({ start: 0, end: 5 })
    expect(linearWindow(100, 99, 4)).toEqual({ start: 95, end: 100 })
  })

  it('clamps invalid centres and empty collections', () => {
    expect(linearWindow(0, 12, 4)).toEqual({ start: 0, end: 0 })
    expect(linearWindow(10, 99, 2)).toEqual({ start: 7, end: 10 })
  })

  it('keeps complete rows around grid focus', () => {
    expect(gridItemVisible(0, 7, 4, 1)).toBe(true)
    expect(gridItemVisible(11, 7, 4, 1)).toBe(true)
    expect(gridItemVisible(12, 7, 4, 1)).toBe(false)
  })

  it('returns complete grid windows with cheap row spacer counts', () => {
    expect(gridWindow(100, 50, 6, 1)).toEqual({ start: 42, end: 60, leadingRows: 7, trailingRows: 7 })
    expect(gridWindow(10, 9, 4, 2)).toEqual({ start: 0, end: 10, leadingRows: 0, trailingRows: 0 })
    expect(gridWindow(0, 0, 6, 1)).toEqual({ start: 0, end: 0, leadingRows: 0, trailingRows: 0 })
  })

  it('collapses omitted flex cards into one legacy-safe spacer', () => {
    expect(horizontalSpacerDimensions(3, 12.25, 165)).toEqual({ width: '37.85vw', minWidth: '509px' })
    expect(horizontalSpacerDimensions(0, 12.25, 165)).toEqual({ width: '0vw', minWidth: '0px' })
  })
})
