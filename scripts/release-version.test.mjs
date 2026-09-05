import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { releaseVersion } from './release-version.mjs'

async function withTree(callback) {
  const base = await mkdtemp(resolve(tmpdir(), 'izumi-release-version-'))
  const write = (name, value) => writeFile(resolve(base, name), typeof value === 'string' ? value : JSON.stringify(value))
  try {
    await mkdir(resolve(base, 'updater')); await mkdir(resolve(base, 'installer'))
    for (const name of ['config.xml', 'updater/config.xml']) await write(name, '<widget version="0.2.36">')
    for (const directory of ['updater', 'installer']) {
      await write(directory + '/package.json', { version: '0.2.36' })
      await write(directory + '/package-lock.json', { version: '0.2.36', packages: { '': { version: '0.2.36' } } })
    }
    await callback(base, write)
  } finally {
    for (const directory of ['updater', 'installer']) {
      for (const name of await readdir(resolve(base, directory))) await unlink(resolve(base, directory, name))
      await rmdir(resolve(base, directory))
    }
    for (const name of await readdir(base)) await unlink(resolve(base, name))
    await rmdir(base)
  }
}
describe('release build versions', () => {
  it('requires the release tag, widgets, installer and lockfiles to agree', async () => {
    await withTree(async (base, write) => {
      await expect(releaseVersion({ base, tag: 'v0.2.36', requireInstaller: true })).resolves.toMatchObject({ version: '0.2.36', installer: true })
      await expect(releaseVersion({ base, tag: 'v0.2.37' })).rejects.toThrow('tag')
      await write('config.xml', '<widget version="0.2.35">')
      await expect(releaseVersion({ base })).rejects.toThrow('config.xml')
      await write('config.xml', '<widget version="0.2.36">')
      await write('installer/package-lock.json', { version: '0.2.36', packages: { '': { version: '0.2.35' } } })
      await expect(releaseVersion({ base })).rejects.toThrow('root')
    })
  })
  it('allows TV-only development checks but refuses an incomplete public release', async () => {
    await withTree(async base => {
      await unlink(resolve(base, 'installer/package.json'))
      await expect(releaseVersion({ base })).resolves.toMatchObject({ installer: false })
      await expect(releaseVersion({ base, requireInstaller: true })).rejects.toThrow('installer source')
    })
  })
})
