'use strict'
const https = require('https')
const url = require('url')
const crypto = require('crypto')

const releaseConfig = require('./release-config.json')
const REPOSITORY = releaseConfig.repository
const LATEST_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`
const PACKAGES = releaseConfig.packages
const MAX_PACKAGE_BYTES = releaseConfig.maxPackageBytes

function version(value) {
  const match = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(String(value || ''))
  if (!match) throw new Error('The release has an invalid version.')
  return match.slice(1).map(Number).join('.')
}
function compareVersions(left, right) {
  const a = version(left).split('.').map(Number), b = version(right).split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  return 0
}
function releaseInfo(release) {
  if (!release || release.draft || release.prerelease || !Array.isArray(release.assets)) throw new Error('No stable izumi release is available.')
  const tag = String(release.tag_name || '')
  const releaseVersion = version(tag)
  const packages = {}
  Object.keys(PACKAGES).forEach((kind) => {
    const definition = PACKAGES[kind]
    const matches = release.assets.filter((asset) => asset && asset.name === definition.asset)
    if (matches.length !== 1) throw new Error(`The release is missing ${definition.asset}. Try again after the release finishes publishing.`)
    const asset = matches[0]
    const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${tag}/${definition.asset}`
    if (asset.state !== 'uploaded' || asset.browser_download_url !== expectedUrl || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !Number.isInteger(asset.size) || asset.size <= 0 || asset.size > MAX_PACKAGE_BYTES) {
      throw new Error(`The release metadata for ${definition.asset} could not be verified.`)
    }
    packages[kind] = Object.assign({}, definition, { url: expectedUrl, sha256: asset.digest.slice(7), size: asset.size, version: releaseVersion })
  })
  return { version: releaseVersion, notes: String(release.body || '').slice(0, 4000), packages }
}
function allowedDownloadUrl(value) {
  const parsed = url.parse(value)
  return parsed.protocol === 'https:' && !parsed.auth && (!parsed.port || parsed.port === '443') &&
    ['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].indexOf(parsed.hostname) >= 0
}
function download(value, options = {}, redirects = 0) {
  if (!allowedDownloadUrl(value) || redirects > 5) return Promise.reject(new Error('An update download used an untrusted destination.'))
  return new Promise((resolve, reject) => {
    const parsed = url.parse(value)
    let settled = false
    const request = https.get(Object.assign({}, parsed, {
      headers: { 'User-Agent': 'izumi-updater', Accept: 'application/vnd.github+json', 'Accept-Encoding': 'identity' },
      ca: options.ca,
      // Node 4 has no minVersion option. Explicit TLS 1.2 remains supported by GitHub.
      secureProtocol: 'TLSv1_2_method',
      rejectUnauthorized: true,
    }), (response) => {
      if ([301, 302, 303, 307, 308].indexOf(response.statusCode) >= 0) {
        response.resume(); finish(null, download(url.resolve(value, response.headers.location || ''), options, redirects + 1)); return
      }
      if (response.statusCode !== 200) { response.resume(); finish(new Error(response.statusCode === 404 ? 'No complete izumi release has been published yet.' : `Update download failed (HTTP ${response.statusCode}).`)); return }
      const maximum = options.limit || MAX_PACKAGE_BYTES
      if (Number(response.headers['content-length']) > maximum) { response.resume(); finish(new Error('The update download exceeds the size limit.')); return }
      let received = 0
      const chunks = []
      response.on('data', (chunk) => {
        received += chunk.length
        if (received > maximum) { finish(new Error('The update download exceeds the size limit.')); request.destroy(); return }
        chunks.push(chunk)
        if (options.progress) options.progress(received, Number(response.headers['content-length']) || options.size || 0)
      })
      response.on('error', finish)
      response.on('aborted', () => finish(new Error('The update download was interrupted.')))
      response.on('end', () => finish(null, Buffer.concat(chunks)))
    })
    const timer = setTimeout(() => { finish(new Error('The update download timed out.')); request.destroy() }, options.timeoutMs || 120000)
    request.on('error', finish)
    function finish(error, result) { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(result) }
  })
}
async function latest(options = {}) {
  const bytes = await download(LATEST_URL, Object.assign({}, options, { limit: 1024 * 1024 }))
  return releaseInfo(JSON.parse(bytes.toString('utf8')))
}
function verifyBytes(bytes, asset) {
  if (bytes.length !== asset.size || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('The downloaded WGT failed its SHA-256 check. Nothing was installed.')
}
async function downloadPackage(asset, options = {}) {
  const bytes = await download(asset.url, Object.assign({}, options, { size: asset.size, limit: asset.size }))
  verifyBytes(bytes, asset)
  return bytes
}
module.exports = { REPOSITORY, LATEST_URL, PACKAGES, MAX_PACKAGE_BYTES, version, compareVersions, releaseInfo, allowedDownloadUrl, download, latest, verifyBytes, downloadPackage }
