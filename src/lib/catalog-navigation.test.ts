import { describe, expect, it } from 'vitest'
import { catalogLevel, mergeAccountOptions, validCatalogOptions } from './catalog-navigation'

describe('account and collection catalogue navigation', () => {
  it('opens collections and folders and provides a predictable remote Back target', () => {
    const folders = [{ screen: 'nc-folder', label: 'Mystery' }]
    const collection = { screen: 'nc-collection', label: 'Film nights', children: folders }
    const root = [{ screen: 'nuvio-collections', label: 'Nuvio collections', children: [collection] }]
    expect(catalogLevel(root, [])).toEqual(root)
    expect(catalogLevel(root, [root[0]])).toEqual([{ screen: '__back', label: 'Back to catalogues' }, collection])
    expect(catalogLevel(root, [root[0], collection])).toEqual([{ screen: '__back', label: 'Back to Nuvio collections' }, ...folders])
  })
  it('removes disconnected account entries while preserving the client catalogues', () => {
    expect(mergeAccountOptions([{ screen: 'tmdb', label: 'TMDB' }, { screen: 'account-nuvio', label: 'Nuvio library' }], []))
      .toEqual([{ screen: 'tmdb', label: 'TMDB' }])
  })
  it('bounds untrusted collection trees and rejects active or credential-bearing artwork', () => {
    expect(validCatalogOptions([{ screen: 'folder', label: 'Folder', cover: 'javascript:alert(1)' }])[0].cover).toBeUndefined()
    expect(validCatalogOptions([{ screen: 'folder', label: 'Folder', cover: 'https://secret:password@example.com/a.png' }])[0].cover).toBeUndefined()
    expect(validCatalogOptions([{ screen: 'a', label: 'A', children: [{ screen: 'b', label: 'B', children: [{ screen: 'c', label: 'C', children: [{ screen: 'd', label: 'D' }] }] }] }])).toEqual([])
    expect(validCatalogOptions(Array.from({ length: 400 }, (_, index) => ({ screen: String(index), label: 'Collection' })))).toHaveLength(200)
  })
})
