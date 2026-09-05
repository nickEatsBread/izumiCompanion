const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '../..')
const requireRoot = createRequire(path.join(root, 'package.json'))
const { Resvg } = requireRoot('@resvg/resvg-js')
const sharp = requireRoot('sharp')
async function run() {
  const assets = path.join(root, 'installer/assets')
  const ui = path.join(root, 'installer/src/renderer/assets')
  await fs.mkdir(ui, { recursive: true })
  const mark = await fs.readFile(path.join(root, 'brand/svg/izumi-mark-color.svg'), 'utf8')
  const inside = mark.slice(mark.indexOf('>') + 1, mark.lastIndexOf('</svg>'))
  // Preserve the original mark. The separate white cog identifies this utility at small sizes.
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256"><rect x="8" y="8" width="240" height="240" rx="56" fill="#0d1721"/><g transform="translate(28 22) scale(1.85)">${inside}</g><circle cx="193" cy="193" r="53" fill="#0d1721"/><g transform="translate(153 153) scale(3.333)" fill="#f4f8ff"><path d="m9.4 1-.6 2.4a9 9 0 0 0-1.6.9L4.8 3.7 2.2 8.2 4 10a9 9 0 0 0 0 2l-1.8 1.8 2.6 4.5 2.4-.6a9 9 0 0 0 1.6.9l.6 2.4h5.2l.6-2.4a9 9 0 0 0 1.6-.9l2.4.6 2.6-4.5L20 12a9 9 0 0 0 0-2l1.8-1.8-2.6-4.5-2.4.6a9 9 0 0 0-1.6-.9L14.6 1Z"/><circle cx="12" cy="11" r="4" fill="#0d1721"/></g></svg>`
  await fs.writeFile(path.join(assets, 'icon.svg'), icon)
  const png = new Resvg(icon, { fitTo: { mode: 'width', value: 1024 } }).render().asPng()
  await fs.writeFile(path.join(assets, 'icon.png'), await sharp(png).resize(512).png().toBuffer())
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = await Promise.all(sizes.map(size => sharp(png).resize(size).png().toBuffer()))
  const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => { const at = 6 + i * 16; header[at] = header[at + 1] = size === 256 ? 0 : size; header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12); offset += images[i].length })
  await fs.writeFile(path.join(assets, 'icon.ico'), Buffer.concat([header, ...images]))
  const chunks = []
  for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const bytes = await sharp(png).resize(size).png().toBuffer(), entry = Buffer.alloc(8)
    entry.write(type); entry.writeUInt32BE(bytes.length + 8, 4); chunks.push(entry, bytes)
  }
  const icns = Buffer.alloc(8); icns.write('icns'); icns.writeUInt32BE(8 + chunks.reduce((n, item) => n + item.length, 0), 4)
  await fs.writeFile(path.join(assets, 'icon.icns'), Buffer.concat([icns, ...chunks]))
  for (const [from, to] of [['izumi-mark-color.svg', 'mark.svg'], ['izumi-wordmark-white.svg', 'wordmark.svg']]) await fs.copyFile(path.join(root, 'brand/svg', from), path.join(ui, to))
  for (const weight of [400, 600, 800]) await fs.copyFile(path.join(root, `node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-${weight}-normal.woff2`), path.join(ui, `nunito-${weight}.woff2`))
  await fs.copyFile(path.join(root, 'node_modules/@fontsource/nunito-sans/LICENSE'), path.join(ui, 'Nunito-Sans-LICENSE.txt'))
  console.log('Generated installer cog icon and staged the original izumi logo and fonts.')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
