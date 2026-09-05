import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { latest, downloadPackage } = require('../updater/runtime/releases.cjs')
const { readWidget } = require('../updater/runtime/widget.cjs')

// Deliberately unauthenticated: this is the same public feed the installed apps use.
const release = await latest()
if (process.env.RELEASE_TAG && 'v' + release.version !== process.env.RELEASE_TAG) throw new Error('The published release is not the public latest release. Mark the intended production release as Latest in GitHub.')
for (const kind of ['companion', 'updater']) {
  const bytes = await downloadPackage(release.packages[kind])
  const { archive } = await readWidget(bytes, kind, release.version)
  if (archive.file('author-signature.xml') || archive.file('signature1.xml')) throw new Error('Public update packages must not contain a TV-specific signature.')
  console.log(`Downloaded and verified public ${kind} ${release.version}.`)
}
