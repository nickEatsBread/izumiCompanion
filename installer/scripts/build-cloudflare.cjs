const path = require('node:path')
const { build } = require('esbuild')

// The reviewed source snapshot and Worker payload travel with this release.
const installer = path.resolve(__dirname, '..')
build({
  entryPoints: [path.join(installer, 'cloudflare-source/native/cloudflare.ts')],
  bundle: true, platform: 'node', target: 'node18', format: 'cjs',
  outfile: path.join(installer, 'src/cloudflare/cloudflare.cjs'),
}).catch(error => { console.error(error.message); process.exitCode = 1 })
