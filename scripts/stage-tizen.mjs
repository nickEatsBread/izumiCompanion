import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(project, 'dist')

await mkdir(output, { recursive: true })
await Promise.all([
  copyFile(resolve(project, 'config.xml'), resolve(output, 'config.xml')),
  copyFile(resolve(project, 'brand/steamgriddb/flat/izumi-companion-square-512x512.png'), resolve(output, 'icon.png')),
  copyFile(resolve(project, 'LICENSE'), resolve(output, 'LICENSE')),
  copyFile(
    resolve(project, 'THIRD-PARTY-NOTICES.md'),
    resolve(output, 'THIRD-PARTY-NOTICES.md'),
  ),
])
