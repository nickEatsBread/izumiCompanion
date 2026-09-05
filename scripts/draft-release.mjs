import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { releaseVersion } from './release-version.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { REPOSITORY, PACKAGES, releaseInfo } = require('../updater/runtime/releases.cjs')
const { version, tag } = await releaseVersion({ requireInstaller: true, tag: process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '' })
if (process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error(`Release publishing is pinned to ${REPOSITORY}.`)
const directory = resolve(root, 'release-assets')
const expected = [
  ...Object.values(PACKAGES).map(pkg => pkg.asset),
  `izumi-Companion-Installer-${version}-Windows.exe`,
  `izumi-Companion-Installer-${version}-arm64.dmg`,
  `izumi-Companion-Installer-${version}-x64.dmg`,
  `izumi-Companion-Installer-${version}-Linux.AppImage`,
  `izumi-Companion-Installer-${version}-Android.apk`,
  `izumi-Companion-Installer-${version}-iOS-unsigned.ipa`,
]
const files = await readdir(directory)
const hashes = new Map()
for (const name of expected) {
  if (!files.includes(name)) throw new Error(`Release build is missing ${name}. Nothing will be published.`)
  const bytes = await readFile(resolve(directory, name))
  if (!bytes.length) throw new Error(`Release asset ${name} is empty.`)
  hashes.set(name, { size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(resolve(directory, 'SHA256SUMS'), expected.map(name => `${hashes.get(name).digest.slice(7)}  ${name}\n`).join(''))
const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', windowsHide: true })
const repository = JSON.parse(gh(['api', `repos/${REPOSITORY}`]))
if (repository.private) throw new Error('The release repository must be public so installed apps can download updates without a GitHub account.')
if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw new Error('The release must target an exact checked-out commit.')
// An existing draft may belong to another run. Never replace or mutate it implicitly.
gh(['release', 'create', tag, ...expected.map(name => resolve(directory, name)), resolve(directory, 'SHA256SUMS'), '--repo', REPOSITORY, '--draft', '--target', process.env.GITHUB_SHA, '--title', `izumi Companion ${tag}`, '--generate-notes'])
let metadata
for (let attempt = 0; attempt < 6; attempt++) {
  const all = JSON.parse(gh(['api', `repos/${REPOSITORY}/releases?per_page=100`]))
  metadata = all.find(item => item.tag_name === tag && item.draft)
  if (metadata && expected.every(name => metadata.assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.digest === hashes.get(name).digest && asset.size === hashes.get(name).size))) break
  if (attempt === 5) throw new Error('GitHub did not confirm every uploaded asset and digest. Leave the release as a draft and inspect the workflow logs.')
  await new Promise(resolveWait => setTimeout(resolveWait, 2000))
}
// GitHub may use temporary "untagged" URLs for drafts. Validate the eventual public
// metadata here; the publication workflow checks the actual URLs and downloads.
releaseInfo({ ...metadata, draft: false, assets: metadata.assets.map(asset => ({ ...asset, browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${tag}/${asset.name}` })) })
console.log(`Draft ${tag} is complete: both WGTs, desktop/mobile installers and verified GitHub digests. Publish it to make it available to update checks.`)
