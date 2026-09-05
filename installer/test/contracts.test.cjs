// Synthetic documentation addresses; no maintainer network data.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const test = require('node:test')
const { SamsungTransport, directStream, parseSdbTarget, parseVdAppList } = require('../src/samsung.cjs')
const { DEVICE_PROFILE_URL, SamsungCertificateCreator } = require('../src/samsung-certificate.cjs')

const root = path.join(__dirname, '..')

test('installer targets the same stable Tizen identity as the WGT', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'installer.config.json'), 'utf8'))
  const widget = fs.readFileSync(path.join(root, '..', 'config.xml'), 'utf8')
  assert.equal(config.minimumTizenVersion, '2.3')
  assert.equal(config.assetPattern, '^izumi-companion\\.wgt$')
  assert.match(widget, new RegExp(`package="${config.packageId}"`))
  assert.match(widget, new RegExp(`id="${config.appId}"`))
})

test('sdb target parsing selects the requested TV', () => {
  const output = 'List of devices attached\n192.0.2.10:26101 device SM_TV\nemulator-26101 device emulator'
  assert.equal(parseSdbTarget(output, '192.0.2.10'), '192.0.2.10:26101')
})

test('direct TV commands wait for an explicit completion marker through idle periods', async () => {
  const stream = new EventEmitter()
  stream.destroy = () => {}
  const client = { createStream: () => stream }
  let settled = false
  const command = directStream(client, 'shell:0 vd_appinstall', {
    timeoutMs: 1_000,
    idleAfterDataMs: 5,
    completeWhen: /install complete/i,
  }).then((output) => {
    settled = true
    return output
  })

  stream.emit('data', Buffer.from('install start\n'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(settled, false)
  stream.emit('data', Buffer.from('install complete\n'))
  assert.equal(await command, 'install start\ninstall complete\n')
})

test('direct TV commands reject a closed stream without the completion marker', async () => {
  const stream = new EventEmitter()
  stream.destroy = () => {}
  const client = { createStream: () => stream }
  const command = directStream(client, 'shell:0 vd_appinstall', {
    timeoutMs: 1_000,
    completeWhen: /install complete/i,
  })

  stream.emit('data', Buffer.from('install start\n'))
  stream.emit('end')
  await assert.rejects(command, /ended before completion[\s\S]*install start/)
})

test('Samsung app-list parsing preserves identifiers used to verify installation', () => {
  const output = [
    'get app list...',
    '---------------------------------------------------------------------------------------------',
    '--------------app_id =IzumiTV001.IzumiTV-------------',
    '--------------app_title =izumi Companion-------------',
    '--------------app_package_name =IzumiTV001-------------',
    '--------------installState =3-------------',
    '---------------------------------------------------------------------------------------------',
  ].join('\n')

  assert.deepEqual(parseVdAppList(output), [{
    app_id: 'IzumiTV001.IzumiTV',
    app_title: 'izumi Companion',
    app_package_name: 'IzumiTV001',
    installState: '3',
  }])
})

test('sdb installation uses the TV package command on older Samsung firmware', async () => {
  const calls = []
  const transport = new SamsungTransport('sdb', '192.0.2.10:26101', () => {}, null, 'sdb')
  transport.shell = async (args) => {
    calls.push(['shell', ...args])
    return args[1] === 'vd_appinstall' ? 'install completed\ncmd_ret:0' : ''
  }
  transport.push = async (localPath, remotePath) => calls.push(['push', localPath, remotePath])
  transport.findInstalledApp = async () => ({ app_id: 'IzumiTV001', app_package_name: 'IzumiTV001' })

  await transport.install('signed.wgt', 'IzumiTV001')

  assert.deepEqual(calls[0], ['shell', '0', 'mkdir', '-p', '/home/owner/share/tmp/sdk_tools'])
  assert.equal(calls[1][0], 'push')
  assert.match(calls[1][2], /\/IzumiTV001-\d+\.wgt$/)
  assert.deepEqual(calls[2], ['shell', '0', 'vd_appinstall', 'IzumiTV001', calls[1][2]])
})

test('Samsung certificate creation gets the TV profile from the v1 distributor endpoint', async () => {
  const requests = []
  class FormDataStub {
    append(name, value) { requests.push([name, value]) }
    getHeaders() { return { test: 'header' } }
  }
  const creator = new SamsungCertificateCreator({
    FormData: FormDataStub,
    fetch: async (url) => {
      requests.push(['url', url])
      return { ok: true, text: async () => '<Profile><TestDevice>TV</TestDevice></Profile>' }
    },
  })

  const result = await creator._fetchDeviceProfile(
    { accessToken: 'token', userId: 'user' },
    { privilegeLevel: 'Public' },
    { csr: 'csr' },
  )

  assert.equal(result, '<Profile><TestDevice>TV</TestDevice></Profile>')
  assert.deepEqual(requests.find(([name]) => name === 'url'), ['url', DEVICE_PROFILE_URL])
  assert.match(DEVICE_PROFILE_URL, /\/apis\/v1\/distributors$/)
})

test('Samsung certificate creation rejects a non-profile success response', async () => {
  class FormDataStub {
    append() {}
    getHeaders() { return {} }
  }
  const creator = new SamsungCertificateCreator({
    FormData: FormDataStub,
    fetch: async () => ({ ok: true, text: async () => '-----BEGIN CERTIFICATE-----' }),
  })
  await assert.rejects(
    creator._fetchDeviceProfile(
      { accessToken: 'token', userId: 'user' },
      { privilegeLevel: 'Public' },
      { csr: 'csr' },
    ),
    /valid TV device profile/,
  )
})

test('installer invalidates identities created without the correct TV device profile', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'installer-core.cjs'), 'utf8')
  assert.match(main, /CERTIFICATE_FORMAT_VERSION\s*=\s*2/)
  assert.match(main, /saved\?\.formatVersion === CERTIFICATE_FORMAT_VERSION/)
  assert.match(main, /await uploadDeviceProfile\(transport, duid, saved\)/)
})

test('renderer keeps Node isolated behind the preload bridge', () => {
  const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8')
  assert.match(main, /contextIsolation:\s*true/)
  assert.match(main, /nodeIntegration:\s*false/)
  assert.match(main, /sandbox:\s*true/)
})

test('install-only command cannot launch the TV application', () => {
  const installOnly = fs.readFileSync(path.join(root, 'src', 'install-only.cjs'), 'utf8')
  assert.match(installOnly, /await transport\.install\(signed, info\.packageId\)/)
  assert.doesNotMatch(installOnly, /transport\.launch|was_execute/)
})
