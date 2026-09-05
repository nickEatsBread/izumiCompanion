import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(resolve(project, 'package-lock.json'), 'utf8'))
const packages = lock.packages ?? {}
const root = packages[''] ?? {}
const queue = Object.keys(root.dependencies ?? {})
const visited = new Set()
const entries = []

async function readLicence(packageName) {
  const directory = resolve(project, 'node_modules', packageName)
  const files = await readdir(directory)
  const filename = files.find((file) => /^(licen[cs]e|copying|notice)([-.].*)?$/i.test(file))
  if (!filename) throw new Error(`No licence file found for ${packageName}`)
  return readFile(resolve(directory, filename), 'utf8')
}

while (queue.length > 0) {
  const name = queue.shift()
  if (!name || visited.has(name)) continue
  visited.add(name)

  const metadata = packages[`node_modules/${name}`]
  if (!metadata) throw new Error(`Missing package-lock metadata for ${name}`)
  queue.push(...Object.keys(metadata.dependencies ?? {}))
  entries.push({
    name,
    version: metadata.version,
    licence: metadata.license ?? 'See included licence text',
    text: (await readLicence(name)).trim(),
  })
}

entries.push({
  name: 'Samsung MultiScreen JavaScript SDK',
  version: '2.3.3',
  licence: 'MIT',
  text: (
    await readFile(
      resolve(project, 'third-party-licenses/samsung-multiscreen-MIT.txt'),
      'utf8',
    )
  ).trim(),
})

entries.push({
  name: 'ISO 639-2 language registry (wooorm/iso-639-2)',
  version: '2026-09-05',
  licence: 'MIT',
  text: (await readFile(resolve(project, 'src/shared/iso-639-2-LICENSE.txt'), 'utf8')).trim(),
})

entries.sort((left, right) => left.name.localeCompare(right.name))

const sections = entries.map(
  ({ name, version, licence, text }) =>
    `## ${name}@${version} — ${licence}\n\n\`\`\`text\n${text}\n\`\`\``,
)
const document = `# Third-party notices

izumiCompanion is licensed under the MIT License. The following components are distributed under
their own licences. These notices are generated from the production dependency tree by
\`npm run notices\` and are included in the packaged Tizen application.

${sections.join('\n\n')}
`

await writeFile(resolve(project, 'THIRD-PARTY-NOTICES.md'), document, 'utf8')
