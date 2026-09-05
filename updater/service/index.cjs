'use strict'
const fs = require('fs')
const path = require('path')
const http = require('http')
const crypto = require('crypto')
const forge = require('node-forge')
const { Sdb, installationProgress } = require('../runtime/sdb.cjs')
const { connectToTV } = require('../runtime/tv-connection.cjs')
const releases = require('../runtime/releases.cjs')
const { signWidget, validateCertificate, authorFingerprint } = require('../runtime/widget.cjs')
const { decryptSetup, parseSetupTransfer, SETUP_PATH, PUBLIC_PATH, RECEIPT_PATH } = require('../runtime/provisioning.cjs')
const { UpdateEngine } = require('./engine.cjs')

const APP_ID = 'IzumiTV001.IzumiTV'
const STAGING = '/home/owner/share/tmp/sdk_tools'
let server, setupServer, setupTimer, engine, directory, certificate, transport, token
function atomic(filename, value) {
  const temporary = filename + '.tmp'
  fs.writeFileSync(temporary, value, { mode: 0o600 }); fs.chmodSync(temporary, 0o600); fs.renameSync(temporary, filename)
}
function readSmall(filename, maximum = 1024 * 1024) {
  if (fs.statSync(filename).size > maximum) throw new Error('Updater setup file exceeds the size limit.')
  return fs.readFileSync(filename, 'utf8')
}
function remove(filename) { try { fs.unlinkSync(filename) } catch (_) {} }
function privateDirectory() {
  return new Promise((resolve, reject) => {
    tizen.filesystem.resolve('wgt-private', (entry) => resolve(decodeURIComponent(entry.toURI().replace(/^file:\/\//, ''))), reject, 'rw')
  })
}
function installedVersion() {
  try { return Promise.resolve(tizen.application.getAppInfo(APP_ID).version) }
  catch (error) { if (error.name === 'NotFoundError') return Promise.resolve(''); return Promise.reject(new Error('Could not read the installed izumi version: ' + error.message)) }
}
function launch() { return new Promise((resolve, reject) => tizen.application.launch(APP_ID, resolve, reject)) }
function publishState() {
  if (!engine) return
  // This receipt is deliberately public: it contains status only, never credentials or API tokens.
  try { atomic(RECEIPT_PATH, JSON.stringify(Object.assign({ schema: 1, node: process.version, privateStorage: true, setupChallenge: setupChallenge }, engine.state, { busy: engine.busy }))) } catch (_) {}
}
async function connect() {
  if (transport) return transport
  try { transport = await connectToTV(Sdb); return transport }
  catch (error) { throw new Error('Could not connect to the TV installation service: ' + error.message + ' Your saved signing identity is still present. Check Developer Mode Host PC IP is 127.0.0.1 and restart the TV by holding remote Power for at least 5 seconds, then pressing Power again if it stays off.') }
}
async function preflight() {
  if (!certificate) throw new Error('Connect the izumi desktop installer once to set up TV updates.')
  validateCertificate(certificate)
  const client = await connect()
  const duid = (await client.command('shell:0 getduid', { timeoutMs: 10000 })).trim().split(/\r?\n/)[0]
  if (duid !== certificate.duid) throw new Error('This signing identity belongs to a different TV. Reconnect the desktop installer.')
}
async function install(signed, progress, installing) {
  const client = await connect()
  const remote = STAGING + '/izumi-companion-' + Date.now() + '.wgt'
  await client.push(STAGING + '/device-profile.xml', Buffer.from(certificate.distributorXML, 'base64'))
  await client.push(remote, signed.bytes, progress)
  installing()
  const output = await client.command('shell:0 vd_appinstall IzumiTV001 ' + remote, {
    timeoutMs: 180000,
    completeWhen: /spend time|install failed|download failed|check certificate error|invalid certificate chain|(?:^|\n)closed(?:\r?\n|$)/i,
    onOutput: (output) => { const percent = installationProgress(output); if (percent !== null) installing(percent) },
  })
  remove(remote)
  if (/failed|\berror\b|cmd_ret:\s*-[0-9]+/i.test(output)) throw new Error('Samsung could not install the update. ' + output.trim().slice(-600))
  // Firmware may update the registry just after completing vd_appinstall.
  for (let count = 0; count < 15; count++) {
    if (await installedVersion() === signed.metadata.version) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

let setupChallenge = '', setupPrivateKey = '', setupExpires = 0, setupStarting = false
async function startSetup() {
  if (setupStarting) return
  setupStarting = true
  try { await configureSetup() } finally { setupStarting = false }
}
async function configureSetup() {
  const keyFile = path.join(directory, 'provisioning-key.pem')
  if (fs.existsSync(keyFile)) setupPrivateKey = readSmall(keyFile, 16000)
  else {
    const keys = await new Promise((resolve, reject) => forge.pki.rsa.generateKeyPair({ bits: 2048, workers: 0 }, (error, pair) => error ? reject(error) : resolve(pair)))
    setupPrivateKey = forge.pki.privateKeyToPem(keys.privateKey)
    atomic(keyFile, setupPrivateKey)
  }
  const key = forge.pki.privateKeyFromPem(setupPrivateKey)
  const publicKey = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(key.n, key.e))
  setupChallenge = crypto.randomBytes(32).toString('hex')
  setupExpires = Date.now() + 10 * 60 * 1000
  remove(SETUP_PATH)
  const handshake = { schema: 1, version: tizen.application.getAppInfo('IzumiUP001.Updater').version, challenge: setupChallenge, publicKey }
  engine.state.setupCode = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 12).toUpperCase().match(/.{4}/g).join('-')
  // Older Samsung firmware has write-only SDB sync. This endpoint exposes public data only.
  // The desktop verifies the public key against the TV's displayed code before sending credentials.
  setupServer = http.createServer((request, response) => {
    if (request.method !== 'GET') return respond(response, 405, { error: 'Read-only setup endpoint.' })
    if (request.url === '/public' && Date.now() < setupExpires) return respond(response, 200, handshake)
    if (request.url === '/receipt') {
      const state = JSON.stringify(Object.assign({ setupChallenge }, engine.state))
      const signature = crypto.createSign('RSA-SHA256').update(state).sign(setupPrivateKey, 'base64')
      return respond(response, 200, { state, signature })
    }
    return respond(response, 404, { error: 'Setup session expired. Reopen izumi Updater.' })
  })
  setupServer.on('error', (error) => engine.report('setup-error', 'Could not start setup: ' + error.message))
  setupServer.listen(18764, '0.0.0.0')
  atomic(PUBLIC_PATH, JSON.stringify(handshake))
  publishState()
  setupTimer = setInterval(() => {
    if (Date.now() > setupExpires) { clearInterval(setupTimer); remove(PUBLIC_PATH); if (setupServer) setupServer.close(); return }
    if (engine.busy || !fs.existsSync(SETUP_PATH)) return
    let payload, envelope
    try {
      payload = readSmall(SETUP_PATH)
      envelope = parseSetupTransfer(payload)
      if (envelope === undefined) return
    } catch (error) { remove(SETUP_PATH); engine.report('setup-error', error.message); return }
    remove(SETUP_PATH)
    try {
      const received = decryptSetup(envelope, setupPrivateKey, setupChallenge)
      const fingerprint = validateCertificate(received)
      if (certificate && (certificate.duid !== received.duid || authorFingerprint(certificate) !== fingerprint)) throw new Error('The installer supplied a different Samsung author identity. Restore the original desktop certificate backup.')
      atomic(path.join(directory, 'samsung-identity.json'), JSON.stringify(received))
      certificate = received
      engine.state.provisioned = true
      engine.state.setupReceipt = crypto.createHash('sha256').update(payload).digest('hex')
      engine.report('setup-complete', 'TV updates are set up. Set Developer Mode Host PC IP to 127.0.0.1 and restart the TV to update without a computer.')
      clearInterval(setupTimer); remove(PUBLIC_PATH)
      setTimeout(() => { if (setupServer) setupServer.close() }, 120000)
    } catch (error) { engine.report('setup-error', 'Setup transfer was rejected: ' + error.message) }
  }, 500)
}
function respond(response, status, value) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
function handle(request, response) {
  // Packaged file origins need CORS, but possession of the private token is still mandatory.
  const origin = request.headers.origin
  if (origin && origin !== 'null' && origin !== 'file://') return respond(response, 403, { error: 'Untrusted origin.' })
  // Some Samsung widget engines omit Origin even for cross-origin XHR.
  response.setHeader('Access-Control-Allow-Origin', '*')
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.writeHead(204); response.end(); return
  }
  if (request.headers.authorization !== 'Bearer ' + token) return respond(response, 403, { error: 'Unauthorized updater request.' })
  if (request.method === 'GET' && request.url === '/state') return respond(response, 200, Object.assign({}, engine.state, { busy: engine.busy }))
  if (request.method !== 'POST' || ['/check', '/update', '/open'].indexOf(request.url) < 0) return respond(response, 404, { error: 'Unknown updater action.' })
  if (engine.busy) return respond(response, 409, { error: 'An update operation is already running.' })
  let body = '', oversized = false
  request.on('data', (chunk) => { body += chunk.toString(); if (body.length > 1024) { oversized = true; request.destroy() } })
  request.on('end', () => {
    if (oversized) return
    let args
    try { args = JSON.parse(body || '{}') } catch (_) { return respond(response, 400, { error: 'Invalid updater request.' }) }
    const task = request.url === '/update' ? engine.update(args.returnToApp === true) : request.url === '/open' ? launch() : engine.check()
    respond(response, 202, { accepted: true })
    Promise.resolve(task).catch(() => {}).then(publishState)
  })
}
async function start() {
  directory = await privateDirectory()
  const identity = path.join(directory, 'samsung-identity.json')
  if (fs.existsSync(identity)) certificate = JSON.parse(readSmall(identity))
  token = crypto.randomBytes(32).toString('hex')
  atomic(path.join(directory, 'api-token'), token)
  // Node 4's TLS context loads only the first certificate from a concatenated PEM string.
  const ca = fs.readFileSync(path.join(__dirname, 'ca.pem'), 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  if (!ca || !ca.length) throw new Error('The updater trust store is missing. Repair izumi Updater with the desktop installer.')
  engine = new UpdateEngine({
    changed: publishState,
    installedVersion,
    provisioned: () => Boolean(certificate),
    latest: () => releases.latest({ ca }),
    preflight,
    download: (asset, progress) => releases.downloadPackage(asset, { ca, progress }),
    sign: (bytes, version) => signWidget(bytes, certificate, 'companion', version),
    install, launch,
    close: () => { if (transport) transport.close(); transport = null },
  })
  engine.state.provisioned = Boolean(certificate)
  engine.state.installedVersion = await installedVersion()
  server = http.createServer(handle)
  server.on('error', (error) => { engine.report('error', 'Update service could not listen: ' + error.message) })
  server.listen(18763, '127.0.0.1')
  await startSetup()
}
module.exports.onStart = () => { start().catch((error) => { try { atomic(RECEIPT_PATH, JSON.stringify({ schema: 1, stage: 'error', message: error.message, node: process.version })) } catch (_) {} }) }
module.exports.onRequest = () => {
  if (!engine || engine.busy || setupStarting) return
  if (setupTimer) clearInterval(setupTimer)
  const restart = () => startSetup().catch((error) => engine.report('setup-error', error.message))
  if (setupServer && setupServer.address()) setupServer.close(restart)
  else restart()
}
module.exports.onStop = () => { if (server) server.close(); if (setupServer) setupServer.close(); if (setupTimer) clearInterval(setupTimer); if (transport) transport.close() }
