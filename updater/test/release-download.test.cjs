const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { createRequire } = require('node:module')
const JSZip = require('jszip')
const { readWidget } = require('../runtime/widget.cjs')
const { UpdateEngine } = require('../service/engine.cjs')
const { REPOSITORY, LATEST_URL, PACKAGES } = require('../runtime/releases.cjs')

function runtime(responses) {
  const filename = path.resolve(__dirname, '../runtime/releases.cjs')
  const realRequire = createRequire(filename), requests = [], module = { exports: {} }
  const https = { get(options, onResponse) {
    const request = new EventEmitter(); request.destroy = () => {}
    const url = options.href
    requests.push(url)
    assert.equal(options.rejectUnauthorized, true)
    assert.equal(options.secureProtocol, 'TLSv1_2_method')
    process.nextTick(() => {
      const fixture = responses[url]
      if (!fixture) { request.emit('error', new Error('Unexpected URL: ' + url)); return }
      const response = new EventEmitter()
      response.statusCode = fixture.status || 200; response.headers = fixture.headers || {}; response.resume = () => {}
      onResponse(response)
      if (fixture.bytes) response.emit('data', fixture.bytes)
      if (fixture.aborted) response.emit('aborted'); else response.emit('end')
    })
    return request
  } }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, Buffer, setTimeout, clearTimeout, require: name => name === 'https' ? https : realRequire(name) }, { filename })
  return { releases: module.exports, requests }
}
async function publishedRelease() {
  const zip = new JSZip()
  zip.file('config.xml', '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" version="0.2.36"><tizen:application id="IzumiTV001.IzumiTV" package="IzumiTV001" required_version="2.3"/></widget>')
  zip.file('index.html', '<html>izumi Companion</html>')
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  const metadata = { tag_name: 'v0.2.36', draft: false, prerelease: false, assets: Object.values(PACKAGES).map(pkg => ({
    name: pkg.asset, state: 'uploaded', size: bytes.length, digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'), browser_download_url: `https://github.com/${REPOSITORY}/releases/download/v0.2.36/${pkg.asset}`,
  })) }
  const url = metadata.assets[0].browser_download_url
  const redirect = 'https://release-assets.githubusercontent.com/github-production-release-asset/izumi-companion.wgt?token=fixture'
  return { metadata, bytes, url, responses: {
    [LATEST_URL]: { bytes: Buffer.from(JSON.stringify(metadata)) },
    [url]: { status: 302, headers: { location: redirect } },
    [redirect]: { bytes, headers: { 'content-length': String(bytes.length) } },
  } }
}
test('public GitHub metadata, CDN redirect and verified WGT drive the full update-and-return sequence', async () => {
  const fixture = await publishedRelease(), { releases, requests } = runtime(fixture.responses)
  let installed = '0.2.35'; const calls = []
  const engine = new UpdateEngine({
    provisioned: () => true, installedVersion: async () => installed,
    latest: () => releases.latest(), preflight: async () => calls.push('preflight'),
    download: (asset, progress) => releases.downloadPackage(asset, { progress }),
    sign: async (bytes, version) => { const widget = await readWidget(bytes, 'companion', version); calls.push('sign'); return { bytes, metadata: widget.metadata } },
    install: async signed => { calls.push('install'); installed = signed.metadata.version },
    launch: async () => calls.push('launch'), close: () => calls.push('close'),
  })
  await engine.update(true)
  assert.equal(engine.state.installedVersion, '0.2.36')
  assert.equal(engine.state.stage, 'complete')
  assert.deepEqual(calls, ['preflight', 'sign', 'install', 'launch', 'close'])
  assert.equal(requests[0], LATEST_URL); assert.equal(requests[1], fixture.url)
})
test('tampered, interrupted and redirected downloads are rejected before signing', async () => {
  const fixture = await publishedRelease()
  const url = fixture.url
  for (const response of [
    { bytes: Buffer.alloc(fixture.bytes.length) },
    { bytes: fixture.bytes.subarray(0, 20), aborted: true },
    { status: 302, headers: { location: 'https://example.com/app.wgt' } },
  ]) {
    const { releases } = runtime({ ...fixture.responses, [url]: response })
    const release = await releases.latest()
    await assert.rejects(releases.downloadPackage(release.packages.companion), /SHA-256|interrupted|untrusted/)
  }
})
