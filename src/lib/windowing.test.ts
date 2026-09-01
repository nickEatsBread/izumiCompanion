import { describe, expect, it } from 'vitest'
import { gridItemVisible, linearWindow } from './windowing'

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
})
