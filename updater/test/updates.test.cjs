const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const JSZip = require('jszip')
const { releaseInfo, verifyBytes, allowedDownloadUrl, compareVersions } = require('../runtime/releases.cjs')
const { encryptSetup, parseSetupTransfer, decryptSetup } = require('../runtime/provisioning.cjs')
const { readWidget } = require('../runtime/widget.cjs')
const { UpdateEngine } = require('../service/engine.cjs')
const { verifyReceipt } = require('../runtime/provisioning.cjs')

function release(version = '0.2.35') {
  return { tag_name: 'v' + version, draft: false, prerelease: false, assets: ['izumi-companion.wgt', 'izumi-updater.wgt'].map((name) => ({ name, state: 'uploaded', size: 3, digest: 'sha256:' + crypto.createHash('sha256').update('wgt').digest('hex'), browser_download_url: `https://github.com/nickEatsBread/izumiCompanion/releases/download/v${version}/${name}` })) }
}
test('release verification requires both pinned, checksummed assets', () => {
  const result = releaseInfo(release())
  assert.equal(result.version, '0.2.35')
  verifyBytes(Buffer.from('wgt'), result.packages.companion)
  assert.throws(() => verifyBytes(Buffer.from('bad'), result.packages.companion), /SHA-256/)
  assert.throws(() => releaseInfo({ ...release(), prerelease: true }), /stable/)
  assert.throws(() => releaseInfo({ ...release(), assets: [] }), /missing/)
  assert.throws(() => releaseInfo({ ...release(), assets: release().assets.map((a) => ({ ...a, digest: null })) }), /verified/)
  assert.throws(() => releaseInfo({ ...release(), assets: release().assets.map((a) => ({ ...a, browser_download_url: 'https://evil.test/app.wgt' })) }), /verified/)
  assert.equal(compareVersions('0.2.100', '0.2.35'), 1)
  for (const url of ['http://github.com/a', 'https://github.com.evil.test/a', 'https://user:secret@github.com/a', 'https://github.com:8443/a', 'file:///tmp/a']) assert.equal(allowedDownloadUrl(url), false)
})
test('setup credentials are encrypted for one TV and one challenge, and tampering fails', () => {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const handshake = { schema: 1, challenge: 'a'.repeat(64), publicKey: pair.publicKey }
  const certificate = { password: 'secret-test-password', authorCert: 'private-test-key' }
  const bytes = encryptSetup(handshake, certificate)
  assert.equal(bytes.toString().includes(certificate.password), false)
  assert.equal(bytes[bytes.length - 1], 10)
  for (let length = 0; length < bytes.length; length++) {
    assert.equal(parseSetupTransfer(bytes.toString('utf8', 0, length)), undefined, 'An incomplete upload must not be consumed')
  }
  const envelope = JSON.parse(bytes)
  assert.deepEqual(parseSetupTransfer(bytes.toString()), envelope)
  const legacy = { ...envelope }; delete legacy.framing
  assert.deepEqual(parseSetupTransfer(JSON.stringify(legacy)), legacy, 'Complete older transfers remain supported')
  assert.throws(() => parseSetupTransfer('{"schema":\n'), SyntaxError, 'Malformed completed transfers must fail')
  assert.deepEqual(decryptSetup(envelope, pair.privateKey, handshake.challenge), certificate)
  assert.throws(() => decryptSetup(envelope, pair.privateKey, 'b'.repeat(64)), /expired/)
  const damaged = Buffer.from(envelope.data, 'base64'); damaged[0] ^= 1
  assert.throws(() => decryptSetup({ ...envelope, data: damaged.toString('base64') }, pair.privateKey, handshake.challenge))
  const state = JSON.stringify({ provisioned: true, setupChallenge: handshake.challenge })
  const receipt = { state, signature: crypto.sign('RSA-SHA256', Buffer.from(state), pair.privateKey).toString('base64') }
  assert.equal(verifyReceipt(receipt, pair.publicKey).provisioned, true)
  assert.throws(() => verifyReceipt({ ...receipt, state: state.replace('true', 'false') }, pair.publicKey), /signature/)
})
async function widget(version = '0.2.35', id = 'IzumiTV001.IzumiTV') {
  const zip = new JSZip()
  zip.file('config.xml', `<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="${version}"><tizen:application id="${id}" package="IzumiTV001" required_version="2.3"/></widget>`)
  zip.file('index.html', '<html>izumi</html>')
  return zip.generateAsync({ type: 'nodebuffer' })
}
test('signing input rejects wrong applications and misleading release versions', async () => {
  assert.equal((await readWidget(await widget(), 'companion', '0.2.35')).metadata.version, '0.2.35')
  await assert.rejects(readWidget(await widget(), 'updater'), /identity/)
  await assert.rejects(readWidget(await widget(), 'companion', '0.2.36'), /version/)
  await assert.rejects(readWidget(await widget('0.2.35', 'Other0001.App'), 'companion'), /identity/)
  const zip = new JSZip(); zip.file('../evil', 'bad'); zip.file('config.xml', 'bad')
  await assert.rejects(readWidget(await zip.generateAsync({ type: 'nodebuffer' }), 'companion'), /unsafe/)
})
function engineFor(overrides = {}) {
  const calls = []; let installed = '0.2.34'
  const engine = new UpdateEngine({
    provisioned: () => true, installedVersion: async () => installed,
    latest: async () => releaseInfo(release()), preflight: async () => { calls.push('preflight') },
    download: async (_asset, progress) => { calls.push('download'); progress(3, 3); return Buffer.from('wgt') },
    sign: async () => { calls.push('sign'); return { bytes: Buffer.from('signed') } },
    install: async () => { calls.push('install'); installed = '0.2.35' },
    launch: async () => { calls.push('launch') }, close: () => calls.push('close'),
    ...overrides,
  })
  return { engine, calls }
}
test('checking never installs; confirmed in-app updates reopen izumi after version verification', async () => {
  const { engine, calls } = engineFor()
  await engine.check(); assert.deepEqual(calls, []); assert.equal(engine.state.updateAvailable, true)
  await engine.update(true)
  assert.deepEqual(calls, ['preflight', 'download', 'sign', 'install', 'launch', 'close'])
  assert.equal(engine.state.stage, 'complete'); assert.equal(engine.state.installedVersion, '0.2.35'); assert.equal(engine.busy, false)
})
test('opening updater directly does not reopen izumi after updating', async () => {
  const { engine, calls } = engineFor(); await engine.update(false)
  assert.equal(calls.includes('launch'), false)
})
test('signing and install failures do not launch or claim success', async () => {
  const { engine, calls } = engineFor({ sign: async () => { throw new Error('Expired certificate') } })
  await assert.rejects(engine.update(true), /Expired/)
  assert.equal(engine.state.stage, 'error'); assert.equal(engine.busy, false); assert.equal(calls.includes('install'), false); assert.equal(calls.includes('launch'), false)
  const other = engineFor({ installedVersion: async () => '0.2.34' })
  await assert.rejects(other.engine.update(true), /expected version/)
  assert.equal(other.calls.includes('launch'), false)
})
test('same-version and older releases cannot reinstall or downgrade the app', async () => {
  for (const installed of ['0.2.35', '0.2.36']) {
    const { engine, calls } = engineFor({ installedVersion: async () => installed })
    await engine.update(false); assert.equal(calls.includes('download'), false); assert.equal(engine.state.stage, 'current')
  }
})
test('concurrent installation requests are serialized and can retry after failure', async () => {
  let finish
  const { engine } = engineFor({ preflight: () => new Promise((resolve) => { finish = resolve }) })
  const operation = engine.update(false)
  await assert.rejects(engine.update(true), /already running/)
  await assert.rejects(engine.check(), /already running/)
  finish(); await operation; assert.equal(engine.busy, false)
})
