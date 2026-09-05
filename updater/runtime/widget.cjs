'use strict'
const JSZip = require('jszip')
const forge = require('node-forge')
const { DOMParser } = require('@xmldom/xmldom')
const Signature = require('tizen/src/packageSigner.js')
const { PACKAGES, version } = require('./releases.cjs')

async function readWidget(bytes, kind, expectedVersion) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error('WGT exceeds the size limit.')
  // Inspect central-directory sizes before asking JSZip to inflate any entry.
  const archive = await JSZip.loadAsync(bytes)
  const names = Object.keys(archive.files)
  if (names.length > 12000) throw new Error('WGT contains too many entries.')
  let total = 0
  for (const name of names) {
    const entry = archive.files[name]
    if (name.indexOf('\\') >= 0 || name[0] === '/' || name.split('/').some((part) => part === '..') || (entry.unsafeOriginalName && entry.unsafeOriginalName !== name)) throw new Error('WGT contains an unsafe path.')
    total += entry._data && entry._data.uncompressedSize || 0
    if (total > 192 * 1024 * 1024) throw new Error('Expanded WGT exceeds the size limit.')
  }
  const config = archive.file('config.xml')
  if (!config || config._data.uncompressedSize > 64 * 1024) throw new Error('WGT is missing valid application metadata.')
  const xml = await config.async('string')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('WGT metadata may not contain XML entities.')
  let invalid = false
  const doc = new DOMParser({ errorHandler: { warning: () => { invalid = true }, error: () => { invalid = true }, fatalError: () => { invalid = true } } }).parseFromString(xml, 'text/xml')
  const apps = doc.getElementsByTagNameNS('http://tizen.org/ns/widgets', 'application')
  const widgets = doc.getElementsByTagNameNS('http://www.w3.org/ns/widgets', 'widget')
  if (invalid || apps.length !== 1 || widgets.length !== 1) throw new Error('Invalid WGT application metadata.')
  const metadata = { packageId: apps[0].getAttribute('package'), appId: apps[0].getAttribute('id'), version: version(widgets[0].getAttribute('version')), requiredVersion: apps[0].getAttribute('required_version') }
  const identity = PACKAGES[kind]
  if (!identity || identity.packageId !== metadata.packageId || identity.appId !== metadata.appId) throw new Error('WGT does not match the expected izumi application identity.')
  if (expectedVersion && metadata.version !== expectedVersion) throw new Error('WGT version does not match the published release.')
  return { archive, metadata }
}
function openP12(encoded, password) {
  return forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(encoded, 'base64').toString('binary'))), false, password)
}
function authorFingerprint(certificate) {
  const key = openP12(certificate.authorCert, certificate.password)
  for (const contents of key.safeContents) for (const bag of contents.safeBags) {
    if (bag.key) return require('crypto').createHash('sha256').update(forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(bag.key.n, bag.key.e))).digest('hex')
  }
  throw new Error('Samsung identity has no author signing key.')
}
function validateCertificate(certificate) {
  if (!certificate || certificate.formatVersion !== 2 || !certificate.duid || !certificate.password || !certificate.authorCert || !certificate.distributorCert || !certificate.distributorXML) throw new Error('The Samsung signing identity is incomplete. Reconnect the desktop installer.')
  const now = Date.now()
  for (const encoded of [certificate.authorCert, certificate.distributorCert]) {
    const key = openP12(encoded, certificate.password)
    let hasKey = false
    for (const contents of key.safeContents) for (const bag of contents.safeBags) {
      if (bag.key) hasKey = true
      if (bag.cert && (now > bag.cert.validity.notAfter.getTime() || now < bag.cert.validity.notBefore.getTime())) throw new Error('A Samsung signing certificate is expired or the TV clock is incorrect. Use the desktop installer to repair it.')
    }
    if (!hasKey) throw new Error('The Samsung signing identity is missing a private key.')
  }
  return authorFingerprint(certificate)
}
async function signWidget(bytes, certificate, kind, expectedVersion) {
  validateCertificate(certificate)
  const { archive, metadata } = await readWidget(bytes, kind, expectedVersion)
  const files = []
  for (const name of Object.keys(archive.files).sort()) {
    const entry = archive.files[name]
    if (entry.dir || name === 'author-signature.xml' || /^signature\d+\.xml$/.test(name)) continue
    files.push({ uri: encodeURIComponent(name), data: await entry.async('nodebuffer') })
  }
  const authorFiles = await new Signature('AuthorSignature', files).sign(openP12(certificate.authorCert, certificate.password))
  const signed = await new Signature('DistributorSignature', authorFiles).sign(openP12(certificate.distributorCert, certificate.password))
  const output = new JSZip()
  signed.forEach((file) => output.file(decodeURIComponent(file.uri), file.data))
  return { bytes: await output.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), metadata }
}
module.exports = { readWidget, signWidget, validateCertificate, authorFingerprint }
