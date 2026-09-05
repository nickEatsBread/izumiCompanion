import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { releaseVersion } from './release-version.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'updater/package.json'))
const { readWidget } = require('./runtime/widget.cjs')
const { version } = await releaseVersion()
for (const kind of ['companion', 'updater']) {
  const { archive, metadata } = await readWidget(await readFile(resolve(root, 'artifacts', `izumi-${kind}.wgt`)), kind, version)
  if (archive.file('author-signature.xml') || archive.file('signature1.xml')) throw new Error('Public WGT artifacts must be unsigned.')
  if (Object.keys(archive.files).some((name) => /samsung-identity|provisioning-key|api-token|\.p12$|\.pfx$/.test(name))) throw new Error('A private setup file was included in a public widget.')
  console.log(`Verified ${kind} ${metadata.version}: stable identity, no device signing material.`)
}
console.log(`Verified both public TV packages for v${version}.`)
