const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const pinned = require('../tv-link-source.json')
const sibling = path.resolve(root, '../izumi-tv-link')
const source = process.env.IZUMI_TV_LINK_PATH || (fs.existsSync(path.join(sibling, 'native/cloudflare.ts')) ? sibling : path.join(root, 'installer/.cache/tv-link'))
function run(command, args, cwd = source) { execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' && command === 'npm' }) }
if (!fs.existsSync(path.join(source, 'package.json'))) {
  fs.mkdirSync(path.dirname(source), { recursive: true })
  run('git', ['clone', '--no-checkout', pinned.repository, source], root)
  run('git', ['checkout', '--detach', pinned.revision])
}
if (!process.env.IZUMI_TV_LINK_PATH) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', windowsHide: true }).trim()
  if (revision !== pinned.revision) throw new Error('TV Link source differs from the pinned revision. Set IZUMI_TV_LINK_PATH explicitly for a development build.')
}
if (!fs.existsSync(path.join(source, 'node_modules/esbuild'))) run('npm', ['ci'])
run('npm', ['run', 'sync:izumi'])
run(process.execPath, ['scripts/build-native.mjs'])
const destination = path.join(root, 'installer/src/cloudflare')
fs.mkdirSync(destination, { recursive: true })
fs.copyFileSync(path.join(source, 'dist-native/cloudflare.cjs'), path.join(destination, 'cloudflare.cjs'))
