import { afterEach, expect, it, vi } from 'vitest'
import { editLayout, orderedLayoutItems, readScreenLayout, writeScreenLayout } from './screen-layout'
afterEach(() => vi.unstubAllGlobals())
const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
it('moves rows, hides them, and restores them at their saved position', () => {
  const moved = editLayout(items, undefined, 'c', 'up')
  const hidden = editLayout(items, moved, 'a', 'toggle')
  expect(orderedLayoutItems(items, hidden, item => item.id)).toEqual([{ id: 'c' }, { id: 'b' }])
  const shown = editLayout(items, hidden, 'a', 'toggle')
  expect(orderedLayoutItems(items, shown, item => item.id)).toEqual([items[0], items[2], items[1]])
})
it('keeps the last row accessible after hiding and catalogue refreshes', () => {
  const layout = editLayout([items[0]], undefined, 'a', 'toggle')
  expect(layout.hidden).toEqual([])
  expect(orderedLayoutItems(items, { order: [], hidden: ['a', 'b', 'c'] }, item => item.id)).toEqual([items[0]])
  expect(orderedLayoutItems(items, { order: ['c'], hidden: [] }, item => item.id)).toEqual([items[2], items[0], items[1]])
})
it('persists each TV profile independently and recovers from malformed storage', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) })
  writeScreenLayout('one', { screens: { order: ['c', 'b'], hidden: ['a'] } })
  expect(readScreenLayout('one').screens.order).toEqual(['c', 'b'])
  expect(readScreenLayout('two')).toEqual({})
})
