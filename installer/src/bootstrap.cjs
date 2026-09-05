const crypto = require('node:crypto')
const http = require('node:http')
const { SETUP_PATH, encryptSetup, setupCode, verifyReceipt } = require('./runtime/provisioning.cjs')
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
function setupRequest(ip, route) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: ip, port: 18764, path: route, timeout: 2500 }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk.toString(); if (body.length > 65536) request.destroy(new Error('Setup response exceeds its size limit.')) })
      response.on('error', reject)
      response.on('end', () => { try { if (response.statusCode !== 200) throw new Error('The updater setup session is unavailable. Reopen izumi Updater.'); resolve(JSON.parse(body)) } catch (error) { reject(error) } })
    })
    request.on('timeout', () => request.destroy(new Error('Waiting for the TV updater service…')))
    request.on('error', reject)
  })
}
async function provisionUpdater(transport, certificate, expectedVersion, log, options) {
  log('info', 'Opening izumi Updater to transfer this TV’s signing identity securely…')
  await transport.launch('IzumiUP001.Updater')
  let handshake
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const candidate = await setupRequest(options.ip, '/public')
      if (candidate.version === expectedVersion) { handshake = candidate; break }
    } catch {}
    await delay(1000)
  }
  if (!handshake) throw new Error('The updater’s background service did not start. Open izumi Updater on the TV and retry. On-TV updates require Tizen 3.0+ with Web service support.')
  // Verify once using the TV display, then pin this public key for subsequent desktop repairs.
  await options.verifyKey(handshake.publicKey, setupCode(handshake.publicKey))
  const encrypted = encryptSetup(handshake, certificate)
  const digest = crypto.createHash('sha256').update(encrypted).digest('hex')
  await transport.pushBytes(SETUP_PATH, encrypted)
  for (let attempt = 0; attempt < 45; attempt++) {
    let receipt
    try { receipt = verifyReceipt(await setupRequest(options.ip, '/receipt'), handshake.publicKey) } catch (error) { if (/signature/.test(error.message)) throw error }
    if (receipt?.setupChallenge === handshake.challenge && receipt.stage === 'setup-error') throw new Error(receipt.message)
    if (receipt?.setupChallenge === handshake.challenge && receipt.setupReceipt === digest && receipt.provisioned) {
      log('success', 'The updater confirmed the encrypted setup transfer. Your signing identity is stored in private TV app storage.')
      return
    }
    await delay(1000)
  }
  throw new Error('The TV did not confirm updater setup. Keep izumi Updater open and retry from this installer.')
}
module.exports = { provisionUpdater, setupRequest, setupCode, verifyReceipt }
