// Maintainer CLI for built artifacts. The desktop UI always downloads the verified release.
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { SamsungTransport } = require('./samsung.cjs')
const { readWidget, signWidget } = require('./runtime/widget.cjs')
const { provisionUpdater } = require('./bootstrap.cjs')
const readline = require('node:readline')
function argument(name) { const index = process.argv.indexOf('--' + name); return index >= 0 ? process.argv[index + 1] : '' }
async function run() {
  const ip = argument('ip')
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.split('.').some((part) => Number(part) > 255)) throw new Error('Pass the TV IP address with --ip.')
  const directory = argument('certificate-dir')
  if (!directory) throw new Error('Pass the existing Samsung identity directory with --certificate-dir.')
  const packages = []
  for (const kind of ['companion', 'updater']) {
    if (!argument(kind)) continue
    const bytes = await fs.readFile(path.resolve(argument(kind)))
    packages.push({ kind, bytes, ...(await readWidget(bytes, kind)) })
  }
  if (!packages.length) throw new Error('Pass --companion and/or --updater with a built WGT.')
  const log = (type, message) => { if (type !== 'output') console.log(`[${type}] ${message}`) }
  const transport = await SamsungTransport.connect(ip, log)
  try {
    const duid = await transport.duid()
    const key = crypto.createHash('sha256').update(duid).digest('hex')
    const certificate = JSON.parse(await fs.readFile(path.join(directory, key + '.json'), 'utf8'))
    if (certificate.duid !== duid) throw new Error('Saved certificate belongs to another TV.')
    await transport.pushBytes('/home/owner/share/tmp/sdk_tools/device-profile.xml', Buffer.from(certificate.distributorXML, 'base64'))
    for (const pkg of packages) {
      log('info', 'Signing ' + pkg.kind + ' ' + pkg.metadata.version)
      const signed = await signWidget(pkg.bytes, certificate, pkg.kind, pkg.metadata.version)
      const outputDirectory = path.resolve(directory, '../signed')
      await fs.mkdir(outputDirectory, { recursive: true })
      const output = path.join(outputDirectory, 'izumi-' + pkg.kind + '.wgt')
      await fs.writeFile(output, signed.bytes, { mode: 0o600 })
      const installed = await transport.install(output, pkg.metadata.packageId)
      if (installed.app_version !== pkg.metadata.version || installed.app_tizen_id !== pkg.metadata.appId) throw new Error('The installed package identity/version does not match the artifact.')
      log('success', 'Verified ' + pkg.metadata.appId + ' ' + installed.app_version)
    }
    const helper = packages.find((pkg) => pkg.kind === 'updater')
    if (helper) await provisionUpdater(transport, certificate, helper.metadata.version, log, {
      ip,
      verifyKey: async (publicKey, expectedCode) => {
        const trustFile = path.join(directory, key + '-updater-public.pem')
        try { if (await fs.readFile(trustFile, 'utf8') === publicKey) return } catch {}
        const input = readline.createInterface({ input: process.stdin, output: process.stdout })
        const code = await new Promise((resolve) => input.question('Enter the desktop setup code shown on the TV: ', resolve))
        input.close()
        if (String(code).replace(/[^a-f0-9]/gi, '').toUpperCase() !== expectedCode.replace(/-/g, '')) throw new Error('The setup code does not match this TV. No credentials were transferred.')
        await fs.writeFile(trustFile, publicKey, { mode: 0o600 })
      },
    })
    if (argument('launch')) await transport.launch('IzumiTV001.IzumiTV')
  } finally { transport.close() }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1 })
