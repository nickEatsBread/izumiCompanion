const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const querystring = require('node:querystring')
const { latest, downloadPackage, compareVersions, REPOSITORY, PACKAGES } = require('./runtime/releases.cjs')
const { signWidget, readWidget } = require('./runtime/widget.cjs')
const { provisionUpdater } = require('./bootstrap.cjs')
const { SamsungTransport } = require('./samsung.cjs')
const { SamsungCertificateCreator } = require('./samsung-certificate.cjs')
const { localAddresses } = require('./network.cjs')
const { InstallationLog } = require('./installation-log.cjs')


function createInstaller(host) {
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'installer.config.json'), 'utf8'))
if (config.githubRepo !== REPOSITORY || config.appId !== PACKAGES.companion.appId || config.packageId !== PACKAGES.companion.packageId || config.updaterAppId !== PACKAGES.updater.appId || config.updaterPackageId !== PACKAGES.updater.packageId) throw new Error('The installer release configuration does not match the TV packages.')
const CERTIFICATE_FORMAT_VERSION = 2
const installationLog = new InstallationLog(path.join(host.userData, 'logs'))
let operationRunning = false
let pendingVerification
let cancelAuthorization

function emit(type, text) {
  const entry = { type, text: host.mobile ? String(text).replace(/\bcomputer\b/g, 'phone') : String(text), at: Date.now() }
  installationLog.append(entry)
  host.onEvent('installer:log', entry)
}



function validIPv4(value) {
  const parts = String(value || '').trim().split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function authPage(done) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>izumi Samsung sign-in</title><style>html{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fafafa;font:16px system-ui}.card{width:min(560px,calc(100vw - 48px));padding:40px;border:1px solid #27272a;border-radius:24px;background:#111114;box-shadow:0 30px 80px #0008}b{display:block;font-size:32px;margin-bottom:12px}p{color:#a1a1aa;line-height:1.6}.dot{display:inline-block;width:10px;height:10px;margin-right:9px;border-radius:50%;background:${done ? '#34d399' : '#a78bfa'};box-shadow:0 0 24px currentColor}</style></head><body><main class="card"><b><span class="dot"></span>${done ? 'Authorization complete' : 'Waiting for Samsung'}</b><p>${done ? 'You can close this tab and return to the installer.' : 'Complete the Samsung account sign-in. The installer will continue automatically.'}</p></main></body></html>`
}

function parseAccessInfo(requestUrl, body = '') {
  const url = new URL(requestUrl, 'http://127.0.0.1:4794')
  const candidates = [url.searchParams.get('code'), url.searchParams.get('accessInfo'), body]
  for (const raw of candidates) {
    if (!raw) continue
    try {
      const value = JSON.parse(raw)
      if (value?.access_token || value?.accessToken) return value
    } catch {}
    const value = querystring.parse(raw)
    const nested = value.code || value.accessInfo
    if (nested && nested !== raw) {
      try {
        const decoded = JSON.parse(String(nested))
        if (decoded?.access_token || decoded?.accessToken) return decoded
      } catch {}
    }
    if (value.access_token || value.accessToken) return value
  }
  const direct = Object.fromEntries(url.searchParams.entries())
  return direct.access_token || direct.accessToken ? direct : null
}

function samsungAuthorization() {
  return new Promise((resolve, reject) => {
    let server
    let settled = false
    const finish = (error, value, response) => {
      if (response) {
        response.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(authPage(!error))
      }
      if (settled) return
      settled = true
      cancelAuthorization = undefined
      clearTimeout(timeout)
      server?.close()
      host.onEvent('installer:auth-complete')
      if (error) reject(error)
      else resolve(value)
    }
    const timeout = setTimeout(() => finish(new Error('Samsung sign-in timed out. Please try again.')), 5 * 60_000)
    cancelAuthorization = () => finish(new Error('Samsung sign-in was cancelled. You can retry installation.'))
    server = http.createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => { if (body.length < 64 * 1024) body += chunk.toString() })
      request.on('end', () => {
        const info = parseAccessInfo(request.url, body)
        if (!info) {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          response.end(authPage(false))
          return
        }
        finish(null, info, response)
      })
    })
    server.on('error', (error) => finish(new Error(`Could not open the local Samsung sign-in callback: ${error.message}`)))
    server.listen(4794, '127.0.0.1', () => {
      emit('info', 'Opening Samsung sign-in to create a certificate for this TV…')
      const authUrl = 'https://account.samsung.com/mobile/account/check.do?serviceID=v285zxnl3h&actionID=StartOAuth2&accessToken=Y&redirect_uri=http://localhost:4794/signin/callback'
      Promise.resolve(host.openExternal(authUrl)).catch(error => finish(error))
    })
  })
}

const certificateDirectory = () => path.join(host.userData, 'samsung-certificates')
const certificatePath = (duid) => path.join(certificateDirectory(), `${crypto.createHash('sha256').update(duid).digest('hex')}.json`)
const deviceProfilePath = (duid) => path.join(certificateDirectory(), `${crypto.createHash('sha256').update(duid).digest('hex')}-device-profile.xml`)
const binaryBase64 = (value) => Buffer.isBuffer(value) ? value.toString('base64') : Buffer.from(value, 'binary').toString('base64')

async function uploadDeviceProfile(transport, duid, certificate) {
  if (!certificate.distributorXML) throw new Error('The Samsung signing identity does not contain a TV device profile.')
  const profilePath = deviceProfilePath(duid)
  await fsp.mkdir(certificateDirectory(), { recursive: true })
  await fsp.writeFile(profilePath, Buffer.from(certificate.distributorXML, 'base64'), { mode: 0o600 })
  await transport.installDeviceProfile(profilePath)
}

async function certificateFor(transport, duid) {
  const savedPath = certificatePath(duid)
  let saved
  try {
    saved = JSON.parse(await fsp.readFile(savedPath, 'utf8'))
  } catch (error) { if (error.code !== 'ENOENT') throw new Error('The saved Samsung identity could not be read. Restore its backup before installing; creating a new author key would break upgrades.') }
  if (!saved) {
    for (const name of ['izumi-companion-installer', 'izumi Companion Installer']) {
      const legacyPath = path.join((host.appData || host.userData), name, 'samsung-certificates', path.basename(savedPath))
      try {
        const candidate = JSON.parse(await fsp.readFile(legacyPath, 'utf8'))
        if (candidate.duid !== duid) throw new Error('A legacy signing backup does not match this TV.')
        saved = candidate
        await fsp.mkdir(certificateDirectory(), { recursive: true })
        await fsp.writeFile(savedPath, JSON.stringify(saved), { mode: 0o600, flag: 'wx' })
        emit('info', 'Preserved the Samsung identity from your previous izumi installer.')
        break
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  if (saved?.formatVersion === CERTIFICATE_FORMAT_VERSION && saved.duid === duid && saved.authorCert && saved.distributorCert && saved.distributorXML && saved.password) {
    emit('info', 'Using the signing identity already saved for this TV.')
    await uploadDeviceProfile(transport, duid, saved)
    return saved
  }

  if (saved) throw new Error('The saved Samsung identity needs repair. Restore a valid backup with the same author key; this installer will not replace it.')
  const existing = await transport.findInstalledApp(config.packageId)
  if (existing) throw new Error('izumi is already installed but its Samsung signing identity is missing from this computer. Restore the original certificate backup before upgrading.')
  const access = await samsungAuthorization()
  const accessToken = access.access_token || access.accessToken
  const userId = access.userId || access.user_id
  if (!accessToken || !userId) throw new Error('Samsung sign-in did not return the required authorization details.')
  const password = crypto.randomBytes(24).toString('base64url')
  emit('info', 'Creating a Samsung certificate for this TV. This can take about a minute…')
  const creator = new SamsungCertificateCreator({ cacheDirectory: host.mobile ? path.join(host.userData, 'samsung-public-chain') : undefined })
  const result = await creator.createCertificate({
    name: 'izumi',
    email: access.inputEmailID || access.email || userId,
    password,
    privilegeLevel: 'Public',
  }, { accessToken, userId }, [duid])
  if (!result.authorCert || !result.distributorCert) throw new Error('Samsung did not return a usable certificate.')

  const created = {
    formatVersion: CERTIFICATE_FORMAT_VERSION,
    duid,
    password,
    authorCert: binaryBase64(result.authorCert),
    distributorCert: binaryBase64(result.distributorCert),
    distributorXML: result.distributorXML ? Buffer.from(result.distributorXML, 'utf8').toString('base64') : '',
    createdAt: new Date().toISOString(),
  }
  await fsp.mkdir(certificateDirectory(), { recursive: true })
  await fsp.writeFile(savedPath, JSON.stringify(created, null, 2), { mode: 0o600 })
  await uploadDeviceProfile(transport, duid, created)
  return created
}

async function verifyUpdaterKey(duid, publicKey, expectedCode) {
  const saved = path.join(certificateDirectory(), crypto.createHash('sha256').update(duid).digest('hex') + '-updater-public.pem')
  try { if (await fsp.readFile(saved, 'utf8') === publicKey) return } catch (error) { if (error.code !== 'ENOENT') throw error }
  emit('info', 'Enter the desktop setup code shown in izumi Updater on the TV. This verifies the destination before transferring your signing identity.')
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('TV verification timed out. Reopen the updater and retry.')), 10 * 60_000)

    function finish(error) {
      clearTimeout(timer); pendingVerification = undefined
      if (error) reject(error); else resolve()
    }
    pendingVerification = {
      cancel: () => finish(new Error('TV verification was cancelled.')),
      answer: (code) => {
        if (code.replace(/[^a-f0-9]/gi, '').toUpperCase() !== expectedCode.replace(/-/g, '')) finish(new Error('The TV setup code did not match. No credentials were transferred.'))
        else finish()
      },
    }
    host.onEvent('installer:verify-key')
  })
  await fsp.writeFile(saved, publicKey, { mode: 0o600 })
}

async function run(request) {
  if (operationRunning) throw new Error('Another TV operation is already running.')
  const action = String(request?.action || '')
  const ip = String(request?.ip || '').trim()
  if (!['connect', 'install', 'launch', 'launch-updater'].includes(action)) throw new Error('Unknown installer action.')
  if (!validIPv4(ip)) throw new Error('Enter a valid IPv4 address for the TV.')
  const log = (type, text) => { if (['info', 'success', 'error', 'command', 'output'].includes(type)) emit(type, text) }
  operationRunning = true
  let transport
  try {
    emit('info', `${action === 'install' ? 'Install / update' : action} started.`)
    transport = await SamsungTransport.connect(ip, log)
    if (action === 'connect') {
      const companion = await transport.findInstalledApp(config.appId)
      emit('success', 'Your TV is connected and ready for setup.')
      return { ok: true, installedVersion: companion?.app_version || '' }
    }
    if (action === 'launch' || action === 'launch-updater') {
      await transport.launch(action === 'launch' ? config.appId : config.updaterAppId)
      emit('success', 'izumi launched on the TV.')
      return { ok: true }
    }
    emit('info', 'Checking the latest verified izumi release…')
    const release = await latest()
    host.onEvent('installer:stage', { phase: 'download', title: 'Downloading izumi.', message: 'Version ' + release.version + ' is on its way.' })
    const kinds = request.enableUpdater === false ? ['companion'] : ['companion', 'updater']
    const packages = []
    for (const kind of kinds) {
      const asset = release.packages[kind]
      const displayName = kind === 'companion' ? 'izumi Companion' : 'izumi Updater'
      emit('info', 'Downloading ' + asset.asset + '…')
      let lastPercent = -1
      const bytes = await downloadPackage(asset, { progress: (received, total) => {
        const percent = total ? Math.floor(received / total * 100) : 0
        if (percent !== lastPercent) { lastPercent = percent; host.onEvent('installer:progress', { label: 'Downloading ' + displayName, percent }) }
      } })
      await readWidget(bytes, kind, release.version)
      packages.push({ kind, bytes, asset })
    }
    const duid = await transport.duid()
    host.onEvent('installer:stage', { phase: 'signing', title: 'Preparing your TV.', message: 'Complete Samsung sign-in if a browser window opens.' })
    host.onEvent('installer:progress', { label: 'Preparing your Samsung signing identity…', percent: null })
    const certificate = await certificateFor(transport, duid)
    for (const pkg of packages) {
      const previous = await transport.findInstalledApp(pkg.asset.packageId)
      if (previous?.app_version && compareVersions(previous.app_version, release.version) > 0) throw new Error('This TV has a newer ' + pkg.asset.asset + ' than the published release. The installer will not downgrade it.')
      emit('info', 'Signing ' + pkg.asset.asset + ' for this TV…')
      const displayName = pkg.kind === 'companion' ? 'izumi Companion' : 'izumi Updater'
      host.onEvent('installer:progress', { label: 'Preparing ' + displayName, percent: null })
      const signed = await signWidget(pkg.bytes, certificate, pkg.kind, release.version)
      const directory = path.join(host.userData, 'signed')
      await fsp.mkdir(directory, { recursive: true })
      const signedPath = path.join(directory, pkg.asset.asset)
      await fsp.writeFile(signedPath, signed.bytes, { mode: 0o600 })
      host.onEvent('installer:stage', { phase: 'install', title: 'Installing on your TV.', message: 'Keep your TV on while we install ' + displayName + '.' })
      const installed = await transport.install(signedPath, pkg.asset.packageId, (percent) => host.onEvent('installer:progress', { label: 'Installing ' + displayName, percent }))
      if (installed.app_version !== release.version) throw new Error('Samsung did not confirm the expected installed version for ' + pkg.asset.asset)
    }
    if (request.enableUpdater !== false) {
      host.onEvent('installer:stage', { phase: 'verify', title: 'Finishing TV setup.', message: 'izumi Updater will open on your TV.' })
      host.onEvent('installer:progress', { label: 'Setting up TV updates…', percent: null })
      await provisionUpdater(transport, certificate, release.version, log, { ip, verifyKey: (publicKey, code) => verifyUpdaterKey(duid, publicKey, code) })
    }
    await transport.launch(config.appId)
    host.onEvent('installer:progress', { label: 'Installation complete', percent: 100 })
    emit('success', request.enableUpdater === false ? 'izumi is installed and ready.' : 'Both apps are ready. Set Developer Mode Host PC IP to 127.0.0.1, then hold the remote’s Power button for at least 5 seconds to restart. If the TV stays off, press Power again.')
    return { ok: true, updater: request.enableUpdater !== false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const friendly = /118019/.test(message)
      ? `${message}\n\nThe TV rejected a package privilege or feature. On-TV updates require Web service support. Select Companion only for TVs without it.`
      : /118012|certificate|signature/i.test(message)
        ? `${message}\n\nThe TV rejected the signing identity. Confirm Developer Mode is enabled, then restart: hold the remote’s Power button for at least 5 seconds. If the TV stays off, press Power again. Retry once it is back on.`
        : message
    emit('error', friendly)
    throw new Error(host.mobile ? friendly.replace(/\bcomputer\b/g, 'phone') : friendly)
  } finally {
    transport?.close()
    operationRunning = false
  }
}

  return {
    run,
    getConfig: async () => ({ version: host.version, minimumTizenVersion: config.minimumTizenVersion, localAddresses: host.localAddresses || await localAddresses().catch(() => []), mobile: Boolean(host.mobile) }),
    verifyCode: code => { if (!pendingVerification) throw new Error('No TV verification is waiting.'); pendingVerification.answer(String(code || '')) },
    logs: installationLog,
    cancelAuthorization: () => cancelAuthorization?.(),
    dispose: () => { pendingVerification?.cancel(); cancelAuthorization?.() },
  }
}

module.exports = { createInstaller }
