const bridge = require('rn-bridge')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { createInstaller } = require('./installer/src/installer-core.cjs')
let installer
let started = false
const send = message => bridge.channel.send(JSON.stringify(message))
const uiRoot = path.join(__dirname, 'installer/src/renderer')
const secret = crypto.randomBytes(24).toString('hex')

bridge.channel.on('message', async raw => {
  let message
  try { message = JSON.parse(raw) } catch { return }
  if (message.type === 'init' && !started) {
    started = true
    const userData = path.join(bridge.app.datadir(), 'izumi-tv-installer')
    fs.mkdirSync(userData, { recursive: true, mode: 0o700 })
    installer = createInstaller({
      userData, mobile: true, version: require('./version.json').version,
      localAddresses: Array.isArray(message.addresses) ? message.addresses : undefined,
      onEvent: (event, value) => send({ type: 'event', event, value }),
      openExternal: async url => send({ type: 'samsung-auth', url }),
    })
    const server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1')
      if (request.method !== 'GET' || !url.pathname.startsWith('/' + secret + '/')) { response.writeHead(404); response.end(); return }
      let relative
      try { relative = decodeURIComponent(url.pathname.slice(secret.length + 2)) || 'index.html' } catch { response.writeHead(400); response.end(); return }
      const file = path.resolve(uiRoot, relative)
      if (!file.startsWith(uiRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)]
      response.writeHead(200, { 'Content-Type': mime || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
      fs.createReadStream(file).pipe(response)
    })
    server.on('error', () => send({ type: 'fatal', error: 'Could not start the local installer interface. Close and reopen the app.' }))
    server.listen(0, '127.0.0.1', () => send({ type: 'ready', url: `http://127.0.0.1:${server.address().port}/${secret}/index.html` }))
    return
  }
  if (message.type !== 'request' || !installer || typeof message.id !== 'string' || message.id.length > 80) return
  try {
    let result
    if (message.scope === 'cloudflare') result = await require('./installer/src/cloudflare/cloudflare.cjs').invoke(message.method, message.input)
    else if (message.scope === 'installer') {
      if (message.method === 'getConfig') result = await installer.getConfig()
      else if (message.method === 'run') result = await installer.run(message.input)
      else if (message.method === 'verifyCode') result = installer.verifyCode(message.input)
      else if (message.method === 'logs') result = installer.logs.text()
      else if (message.method === 'cancelAuthorization') result = installer.cancelAuthorization()
      else throw new Error('Unknown installer action.')
    } else throw new Error('Unknown mobile request.')
    send({ type: 'result', id: message.id, result })
  } catch (error) { send({ type: 'result', id: message.id, error: String(error.message || error).slice(0, 2000) }) }
})
send({ type: 'runtime-ready' })
