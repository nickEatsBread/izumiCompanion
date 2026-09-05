import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { rootCertificates } from 'node:tls'
import { build } from 'esbuild'
import { transformAsync } from '@babel/core'
import presetEnv from '@babel/preset-env'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(project, 'updater/dist')
if (output !== resolve(project, 'updater', 'dist')) throw new Error('Unexpected updater build directory.')
await rm(output, { force: true, recursive: true })
await mkdir(resolve(output, 'service'), { recursive: true })
const result = await build({
  absWorkingDir: project, entryPoints: ['updater/service/index.cjs'], bundle: true,
  platform: 'node', format: 'cjs', target: 'es2015', write: false,
  legalComments: 'eof',
})
const transformed = await transformAsync(result.outputFiles[0].text, {
  babelrc: false, configFile: false, sourceType: 'script',
  presets: [[presetEnv, { targets: { ie: '11' }, modules: false }]],
})
const polyfills = await build({
  absWorkingDir: project, stdin: { contents: "require('core-js/stable');", resolveDir: project },
  bundle: true, platform: 'node', target: 'es2015', format: 'cjs', write: false,
})
const prelude = `if(!Buffer.from)Buffer.from=function(v,e){if(typeof v==='number')throw new TypeError('Expected bytes');return new Buffer(v,e);};
if(!Buffer.alloc)Buffer.alloc=function(n){var b=new Buffer(n);b.fill(0);return b;};
if(!Buffer.allocUnsafe)Buffer.allocUnsafe=function(n){return new Buffer(n);};
if(!require('crypto').constants)require('crypto').constants=require('constants');\n`
const compatiblePolyfills = await transformAsync(polyfills.outputFiles[0].text, {
  babelrc: false, configFile: false, sourceType: 'script',
  presets: [[presetEnv, { targets: { ie: '11' }, modules: false }]],
})
const serviceCode = prelude + compatiblePolyfills.code + '\n' + transformed.code
const { parse } = await import('acorn')
parse(serviceCode, { ecmaVersion: 5, sourceType: 'script', allowReserved: true })
await writeFile(resolve(output, 'service/index.js'), serviceCode)
// The TV's old Node trust store is stale. Supply current trusted roots without disabling TLS verification.
await writeFile(resolve(output, 'service/ca.pem'), rootCertificates.join('\n'))
for (const file of ['config.xml', 'index.html', 'styles.css', 'ui.js']) await cp(resolve(project, 'updater', file), resolve(output, file))
await cp(resolve(project, 'brand/steamgriddb/flat/izumi-companion-square-512x512.png'), resolve(output, 'icon.png'))
await cp(resolve(project, 'brand/svg/izumi-wordmark-white.svg'), resolve(output, 'wordmark.svg'))
await cp(resolve(project, 'node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2'), resolve(output, 'font.woff2'))
await cp(resolve(project, 'updater/LICENSE'), resolve(output, 'LICENSE'))
await cp(resolve(project, 'updater/THIRD-PARTY-NOTICES.md'), resolve(output, 'THIRD-PARTY-NOTICES.md'))
await mkdir(resolve(output, 'licenses'), { recursive: true })
for (const [name, license] of [['tizen', 'LICENSE'], ['tizen', 'LICENSE_APACHE2'], ['jszip', 'LICENSE.markdown'], ['node-forge', 'LICENSE'], ['@xmldom/xmldom', 'LICENSE']]) {
  await cp(resolve(project, 'updater/node_modules', name, license), resolve(output, 'licenses', name.replace('/', '-') + '-' + license))
}
await cp(resolve(project, 'updater/node_modules/tizen/NOTICE'), resolve(output, 'licenses/tizen-NOTICE'))
await cp(resolve(project, 'node_modules/core-js/LICENSE'), resolve(output, 'licenses/core-js-LICENSE'))
await cp(resolve(project, 'node_modules/@fontsource/nunito-sans/LICENSE'), resolve(output, 'licenses/Nunito-Sans-LICENSE'))
const require = createRequire(resolve(project, 'updater/package.json'))
const JSZip = require('jszip')
async function zipDirectory(zip, directory, prefix = '') {
  const { readdir } = await import('node:fs/promises')
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) await zipDirectory(zip, resolve(directory, entry.name), prefix + entry.name + '/')
    else zip.file(prefix + entry.name, await readFile(resolve(directory, entry.name)))
  }
}
const zip = new JSZip()
await zipDirectory(zip, output)
await mkdir(resolve(project, 'artifacts'), { recursive: true })
await writeFile(resolve(project, 'artifacts/izumi-updater.wgt'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log('Built artifacts/izumi-updater.wgt (Node 4.4 / Chromium 56).')
