import { describe, expect, it } from 'vitest'
import { newerVersion, updateVersionFromRelease } from './updates'

const release = (version = '0.2.35') => ({
  tag_name: `v${version}`, draft: false, prerelease: false,
  assets: ['izumi-companion.wgt', 'izumi-updater.wgt'].map((name) => ({ name, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/nickEatsBread/izumiCompanion/releases/download/v${version}/${name}` })),
})
describe('TV update discovery', () => {
  it('compares versions numerically and does not offer downgrades', () => {
    expect(newerVersion('0.2.100', '0.2.35')).toBe(true)
    expect(newerVersion('0.2.35', '0.2.35')).toBe(false)
    expect(newerVersion('0.2.34', '0.2.35')).toBe(false)
    expect(newerVersion('bad', '0.2.35')).toBe(false)
  })
  it('requires a complete stable release with checksummed packages', () => {
    expect(updateVersionFromRelease(release())).toBe('0.2.35')
    expect(updateVersionFromRelease({ ...release(), prerelease: true })).toBeUndefined()
    expect(updateVersionFromRelease({ ...release(), assets: release().assets.slice(0, 1) })).toBeUndefined()
    expect(updateVersionFromRelease({ ...release(), assets: release().assets.map((asset) => ({ ...asset, digest: undefined })) })).toBeUndefined()
  })
  it('rejects redirected identities and untrusted download links', () => {
    expect(updateVersionFromRelease({ ...release(), assets: release().assets.map((asset) => ({ ...asset, browser_download_url: 'https://example.com/' + asset.name })) })).toBeUndefined()
  })
})
