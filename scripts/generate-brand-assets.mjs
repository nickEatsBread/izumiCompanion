import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgDirectory = resolve(project, 'brand/svg')
const pngDirectory = resolve(project, 'brand/png')
const steamGridSourceDirectory = resolve(project, 'brand/steamgriddb/source-flat')
const steamGridOutputDirectory = resolve(project, 'brand/steamgriddb/flat')
const fontPath = resolve(project, 'node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-600-normal.woff2')

function pathData(svg, label) {
  const match = svg.match(/<path d="([^"]+)"/)
  if (!match) throw new Error(`Could not read the ${label} path.`)
  return match[1]
}

function logoArtwork({ markPath, wordmarkPath, fontData, foreground, descriptor }) {
  return `
    <style>
      @font-face {
        font-family: "Izumi Companion Sans";
        src: url("data:font/woff2;base64,${fontData}") format("woff2");
        font-style: normal;
        font-weight: 600;
      }
    </style>
    <defs>
      <linearGradient id="izumi-companion-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#5CEAD8"/>
        <stop offset="0.55" stop-color="#1FA6F0"/>
        <stop offset="1" stop-color="#4E63F5"/>
      </linearGradient>
    </defs>
    <g aria-label="izumi companion">
      <path d="${markPath}" fill="url(#izumi-companion-gradient)" transform="translate(0 10) scale(1.2)"/>
      <path d="${wordmarkPath}" fill="${foreground}" transform="translate(124 99) scale(.118 -.118)"/>
      <text x="125" y="137" fill="${descriptor}" font-family="Izumi Companion Sans, Nunito Sans, Arial, sans-serif" font-size="28" font-weight="600" letter-spacing="1.25">companion</text>
    </g>`
}

function lockupSvg(artwork) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="468" height="154" viewBox="0 0 468 154" role="img" aria-label="izumi companion">
  ${artwork.trimStart()}
</svg>
`
}

await mkdir(svgDirectory, { recursive: true })
await mkdir(pngDirectory, { recursive: true })
await mkdir(steamGridOutputDirectory, { recursive: true })

const [markSvg, wordmarkSvg, font] = await Promise.all([
  readFile(resolve(svgDirectory, 'izumi-mark-color.svg'), 'utf8'),
  readFile(resolve(svgDirectory, 'izumi-wordmark-white.svg'), 'utf8'),
  readFile(fontPath),
])

const markPath = pathData(markSvg, 'izumi mark')
const wordmarkPath = pathData(wordmarkSvg, 'izumi wordmark')
const fontData = font.toString('base64')
const darkArtwork = logoArtwork({
  markPath,
  wordmarkPath,
  fontData,
  foreground: '#F4F8FF',
  descriptor: '#9CB1C6',
})
const lightArtwork = logoArtwork({
  markPath,
  wordmarkPath,
  fontData,
  foreground: '#14233F',
  descriptor: '#61738C',
})
const darkLockup = lockupSvg(darkArtwork)
const lightLockup = lockupSvg(lightArtwork)

function renderPng(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng()
}

function steamGridSvg({ source, width, height }) {
  const ratio = width / height
  const isPortrait = ratio < .9
  const isSquare = ratio >= .9 && ratio <= 1.1
  const x = isPortrait || isSquare ? width * .5 : width * .522
  const y = isPortrait ? height * .855 : isSquare ? height * .93 : height * .75
  const fontSize = isPortrait ? height * .05 : isSquare ? height * .052 : height * .09
  const letterSpacing = fontSize * .045
  const anchor = isPortrait || isSquare ? 'middle' : 'start'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="izumi companion Steam library artwork">
    <style>
      @font-face {
        font-family: "Izumi Companion Sans";
        src: url("data:font/woff2;base64,${fontData}") format("woff2");
        font-style: normal;
        font-weight: 600;
      }
    </style>
    <image href="data:image/png;base64,${source.toString('base64')}" width="${width}" height="${height}"/>
    <text x="${x}" y="${y}" fill="#9CB1C6" text-anchor="${anchor}" font-family="Izumi Companion Sans, Nunito Sans, Arial, sans-serif" font-size="${fontSize}" font-weight="600" letter-spacing="${letterSpacing}">companion</text>
  </svg>`
}

await Promise.all([
  writeFile(resolve(svgDirectory, 'izumi-companion-lockup-dark.svg'), darkLockup),
  writeFile(resolve(svgDirectory, 'izumi-companion-lockup-light.svg'), lightLockup),
  writeFile(resolve(pngDirectory, 'izumi-companion-lockup-dark-936.png'), renderPng(darkLockup, 936)),
  writeFile(resolve(pngDirectory, 'izumi-companion-lockup-light-936.png'), renderPng(lightLockup, 936)),
])

for (const filename of await readdir(steamGridSourceDirectory)) {
  const match = filename.match(/-(\d+)x(\d+)\.png$/)
  if (!match) continue
  const width = Number(match[1])
  const height = Number(match[2])
  const source = await readFile(resolve(steamGridSourceDirectory, filename))
  const svg = steamGridSvg({ source, width, height })
  const output = filename.replace(/^izumi-/, 'izumi-companion-')
  await writeFile(resolve(steamGridOutputDirectory, output), renderPng(svg, width))
}
