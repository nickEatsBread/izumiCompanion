import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import { checkTvUpdate, newerVersion, updateVersionFromRelease, UPDATE_RELEASE_URL } from './updates'
const require = createRequire(import.meta.url)
const { releaseInfo, LATEST_URL } = require('../../updater/runtime/releases.cjs')

const release = (version = '0.2.35') => ({
  tag_name: `v${version}`, draft: false, prerelease: false,
  assets: ['izumi-companion.wgt', 'izumi-updater.wgt'].map((name) => ({ name, state: 'uploaded', size: 1024, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `https://github.com/nickEatsBread/izumiCompanion/releases/download/v${version}/${name}` })),
})
describe('TV update discovery', () => {
  afterEach(() => vi.unstubAllGlobals())
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
  it('the popup and installer/helper accept the same complete GitHub metadata', () => {
    expect(UPDATE_RELEASE_URL).toBe(LATEST_URL)
    const valid = release('0.2.36')
    expect(updateVersionFromRelease(valid)).toBe(releaseInfo(valid).version)
    const invalid = [
      { ...valid, draft: true }, { ...valid, prerelease: true },
      { ...valid, assets: [...valid.assets, valid.assets[0]] },
      ...[{ size: 0 }, { size: 67108865 }, { size: 1.5 }, { state: 'new' }, { digest: null }, { browser_download_url: 'https://example.com/izumi-companion.wgt' }].map(patch => ({ ...valid, assets: valid.assets.map(asset => ({ ...asset, ...patch })) })),
      { ...valid, assets: [null] },
    ]
    for (const metadata of invalid) {
      expect(updateVersionFromRelease(metadata)).toBeUndefined()
      expect(() => releaseInfo(metadata)).toThrow()
    }
  })
  it('checks the GitHub endpoint using the installed Tizen version and reports the helper', async () => {
    const open = vi.fn()
    class Request {
      status = 200; responseText = JSON.stringify(release('0.2.36')); onload?: () => void
      open = open
      send() { this.onload?.() }
    }
    vi.stubGlobal('window', { tizen: { application: { getCurrentApplication: () => ({ appInfo: { version: '0.2.35' } }), getAppInfo: () => ({ id: 'IzumiUP001.Updater' }) } } })
    vi.stubGlobal('XMLHttpRequest', Request)
    await expect(checkTvUpdate()).resolves.toEqual({ version: '0.2.36', helperInstalled: true })
    expect(open).toHaveBeenCalledWith('GET', LATEST_URL)
  })
})
