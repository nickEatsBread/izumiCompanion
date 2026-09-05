'use strict'
const crypto = require('crypto')
const SETUP_PATH = '/home/owner/share/tmp/sdk_tools/izumi-updater-setup.json'
const PUBLIC_PATH = '/home/owner/share/tmp/sdk_tools/izumi-updater-public.json'
const RECEIPT_PATH = '/home/owner/share/tmp/sdk_tools/izumi-updater-receipt.json'
function encryptSetup(handshake, certificate) {
  if (!handshake || handshake.schema !== 1 || !/^[a-f0-9]{64}$/.test(handshake.challenge) || !/^-----BEGIN PUBLIC KEY-----/.test(handshake.publicKey)) throw new Error('Invalid updater setup handshake.')
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(handshake.challenge))
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ challenge: handshake.challenge, certificate }), 'utf8'), cipher.final()])
  const envelope = { schema: 1, challenge: handshake.challenge, key: crypto.publicEncrypt({ key: handshake.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }
  key.fill(0)
  return Buffer.from(JSON.stringify(envelope))
}
function decryptSetup(envelope, privateKey, challenge) {
  if (!envelope || envelope.schema !== 1 || envelope.challenge !== challenge) throw new Error('This setup transfer has expired. Retry from the desktop installer.')
  const key = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.key, 'base64'))
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAAD(Buffer.from(challenge)); decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'))
    if (payload.challenge !== challenge) throw new Error('Incorrect setup challenge.')
    return payload.certificate
  } finally { key.fill(0) }
}
function setupCode(publicKey) { return crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 12).toUpperCase().match(/.{4}/g).join('-') }
function verifyReceipt(envelope, publicKey) {
  if (!envelope || typeof envelope.state !== 'string' || typeof envelope.signature !== 'string' || !crypto.createVerify('RSA-SHA256').update(envelope.state).verify(publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('The TV setup receipt failed signature verification.')
  return JSON.parse(envelope.state)
}
module.exports = { SETUP_PATH, PUBLIC_PATH, RECEIPT_PATH, encryptSetup, decryptSetup, setupCode, verifyReceipt }
