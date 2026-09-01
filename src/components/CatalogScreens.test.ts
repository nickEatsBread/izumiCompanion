import { describe, expect, it } from 'vitest'
import { SEARCH_KEYS, adjacentSearchKey, nearestSearchKey } from './CatalogScreens'

describe('TV search keyboard geometry', () => {
  it('uses QWERTY rows with stable right-edge actions', () => {
    expect(SEARCH_KEYS.slice(0, 10).map((key) => key.value).join('')).toBe('QWERTYUIOP')
    expect(SEARCH_KEYS.filter((key) => key.row === 1).map((key) => key.value)).toEqual([
      ...'ASDFGHJKL',
      'DELETE',
    ])
    expect(SEARCH_KEYS[SEARCH_KEYS.length - 2]).toMatchObject({ value: 'SPACE', row: 2, column: 7, span: 2 })
    expect(SEARCH_KEYS[SEARCH_KEYS.length - 1]).toMatchObject({ value: 'CLEAR', row: 2, column: 9 })
  })

  it('moves spatially instead of wrapping at a row edge', () => {
    expect(adjacentSearchKey(0, 'left')).toBeUndefined()
    expect(adjacentSearchKey(9, 'right')).toBeUndefined()
    expect(SEARCH_KEYS[adjacentSearchKey(9, 'down')!].value).toBe('DELETE')
    expect(SEARCH_KEYS[nearestSearchKey(2, 9)].value).toBe('CLEAR')
  })
})
