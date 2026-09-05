import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'updater/package.json'))
const JSZip = require('jszip')
const zip = new JSZip()
await readFile(resolve(root, 'dist/config.xml'))
async function add(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) await add(resolve(directory, entry.name), prefix + entry.name + '/')
    else zip.file(prefix + entry.name, await readFile(resolve(directory, entry.name)))
  }
}
await add(resolve(root, 'dist'))
await mkdir(resolve(root, 'artifacts'), { recursive: true })
await writeFile(resolve(root, 'artifacts/izumi-companion.wgt'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log('Created artifacts/izumi-companion.wgt')
