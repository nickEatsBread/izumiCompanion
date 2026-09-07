import { describe, expect, it } from 'vitest'
import { searchIsLoading, titleSuggestions } from './search-suggestions'
import type { CompanionMedia } from '../types'

const media = (title: string): CompanionMedia => ({ title, ref: { provider: 'test', type: 'movie', id: title } })
describe('TV search presentation', () => {
  it('keeps skeletons through debounce and hides them only for the settled query', () => {
    expect(searchIsLoading('matrix', '', false)).toBe(true)
    expect(searchIsLoading('matrix', 'mat', false)).toBe(true)
    expect(searchIsLoading('matrix', 'matrix', true)).toBe(true)
    expect(searchIsLoading(' Matrix ', 'matrix', false)).toBe(false)
    expect(searchIsLoading('', 'matrix', true)).toBe(false)
  })
  it('suggests matching titles once, with prefix matches before partial matches', () => {
    expect(titleSuggestions('Matrix', ['The Matrix', 'Matrix Reloaded', 'the matrix'].map(media), ['Action'])).toEqual([
      { label: 'Matrix Reloaded', kind: 'title' }, { label: 'The Matrix', kind: 'title' },
    ])
    expect(titleSuggestions('', [], ['Action', 'Drama'])).toEqual([
      { label: 'Action', kind: 'genre' }, { label: 'Drama', kind: 'genre' },
    ])
    expect(titleSuggestions('film', Array.from({ length: 20 }, (_, i) => media(`Film ${i}`)), [])).toHaveLength(6)
  })
})
