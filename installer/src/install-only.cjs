const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const JSZip = require('jszip')
const { DOMParser } = require('@xmldom/xmldom')
const { signPackage } = require('./package-signing.cjs')
const { SamsungTransport } = require('./samsung.cjs')

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : ''
}

async function metadata(packagePath) {
  const archive = await JSZip.loadAsync(await fsp.readFile(packagePath))
  const entry = archive.file('config.xml')
  if (!entry) throw new Error('The WGT has no config.xml.')
  const document = new DOMParser().parseFromString(await entry.async('string'), 'text/xml')
  const application = document.getElementsByTagName('tizen:application')[0]
    || document.getElementsByTagNameNS('http://tizen.org/ns/widgets', 'application')[0]
  if (!application) throw new Error('The WGT has no Tizen application metadata.')
  return {
    packageId: application.getAttribute('package') || '',
    appId: application.getAttribute('id') || '',
  }
}

async function run() {
  const ip = argument('ip')
  const packagePath = path.resolve(argument('package'))
  const certificateDirectory = path.resolve(argument('certificate-dir'))
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) throw new Error('Pass the TV IPv4 address with --ip.')
  if (!fs.existsSync(packagePath) || path.extname(packagePath).toLowerCase() !== '.wgt') {
    throw new Error('Pass an existing WGT with --package.')
  }
  if (!fs.existsSync(certificateDirectory)) throw new Error('Pass the saved signing directory with --certificate-dir.')

  const info = await metadata(packagePath)
  if (![['IzumiTV001', 'IzumiTV001.IzumiTV'], ['IzumiUP001', 'IzumiUP001.Updater']].some(([pkg, id]) => info.packageId === pkg && info.appId === id)) {
    throw new Error('The selected WGT is not an izumi Companion or Updater package.')
  }

  const log = (type, message) => { if (type !== 'output') process.stdout.write(`[${type}] ${String(message).trim()}\n`) }
  const transport = await SamsungTransport.connect(ip, log)
  try {
    const duid = await transport.duid()
    const key = crypto.createHash('sha256').update(duid).digest('hex')
    const certificatePath = path.join(certificateDirectory, `${key}.json`)
    const profilePath = path.join(certificateDirectory, `${key}-device-profile.xml`)
    const certificate = JSON.parse(await fsp.readFile(certificatePath, 'utf8'))
    if (certificate.duid !== duid || !certificate.authorCert || !certificate.distributorCert || !certificate.password) {
      throw new Error('The saved signing identity does not match this TV.')
    }
    if (!fs.existsSync(profilePath)) {
      if (!certificate.distributorXML) throw new Error('The signing identity has no TV device profile.')
      await fsp.writeFile(profilePath, Buffer.from(certificate.distributorXML, 'base64'), { mode: 0o600 })
    }
    await transport.installDeviceProfile(profilePath)
    log('info', 'Signing the package for this TV…')
    const signed = await signPackage(packagePath, certificate, path.join(certificateDirectory, '..', 'signed'))
    await transport.install(signed, info.packageId)
    log('success', `Installed ${info.appId}. The application was not launched.`)
  } finally {
    transport.close()
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
