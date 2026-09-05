import { readFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const json = async (base, file) => JSON.parse(await readFile(resolve(base, file), 'utf8'))
export async function releaseVersion({ base = root, requireInstaller = false, tag = '' } = {}) {
  const updater = await json(base, 'updater/package.json')
  const version = updater.version
  if (!/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(version)) throw new Error('Use a stable numeric release version, for example 0.2.36.')
  const versions = new Map()
  for (const file of ['config.xml', 'updater/config.xml']) {
    versions.set(file, (await readFile(resolve(base, file), 'utf8')).match(/<widget\b[^>]*\bversion="([^"]+)"/)?.[1])
  }
  for (const file of ['updater/package-lock.json']) {
    const lock = await json(base, file)
    versions.set(file, lock.version); versions.set(file + ' root', lock.packages?.['']?.version)
  }
  let installer = false
  try { await access(resolve(base, 'installer/package.json')); installer = true } catch {}
  if (requireInstaller && !installer) throw new Error('A public release requires the desktop installer source. Include installer/ before starting the release workflow.')
  if (installer) {
    versions.set('installer/package.json', (await json(base, 'installer/package.json')).version)
    const lock = await json(base, 'installer/package-lock.json')
    versions.set('installer/package-lock.json', lock.version); versions.set('installer/package-lock.json root', lock.packages?.['']?.version)
  }
  let mobile = false
  try { await access(resolve(base, 'mobile/package.json')); mobile = true } catch {}
  if (mobile) {
    versions.set('mobile/package.json', (await json(base, 'mobile/package.json')).version)
    const lock = await json(base, 'mobile/package-lock.json')
    versions.set('mobile/package-lock.json', lock.version); versions.set('mobile/package-lock.json root', lock.packages?.['']?.version)
    const android = await readFile(resolve(base, 'mobile/android/app/build.gradle'), 'utf8')
    versions.set('mobile Android versionName', android.match(/versionName\s+"([^"]+)"/)?.[1])
    const ios = await readFile(resolve(base, 'mobile/ios/IzumiInstaller.xcodeproj/project.pbxproj'), 'utf8')
    for (const [index, match] of [...ios.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)].entries()) versions.set('mobile iOS configuration ' + index, match[1])
  }
  for (const [file, actual] of versions) if (actual !== version) throw new Error(`${file} is ${actual}; all release packages must be ${version}.`)
  if (tag && tag !== 'v' + version) throw new Error(`Release tag ${tag} does not match package version v${version}.`)
  return { version, tag: 'v' + version, installer }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await releaseVersion({ requireInstaller: process.argv.includes('--require-installer'), tag: process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : '' })
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\ninstaller=${result.installer}\n`)
  }
  console.log(`Release versions match ${result.tag}.`)
}
