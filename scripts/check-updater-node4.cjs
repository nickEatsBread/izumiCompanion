'use strict'
// Run the packaged service with Node 4.4.3. All TV storage and listeners are
// redirected to a temporary directory and random localhost ports in this process.
var assert = require('assert'), fs = require('fs'), path = require('path')
var vm = require('vm'), http = require('http'), crypto = require('crypto'), os = require('os')
assert.equal(process.version, 'v4.4.3', 'Run this check with the TV Node runtime')
var root = path.resolve(__dirname, '..'), bundle = path.join(root, 'updater/dist/service/index.js')
var temporary = path.join(os.tmpdir(), 'izumi-node4-' + crypto.randomBytes(8).toString('hex'))
var privateDir = path.join(temporary, 'private'), staging = path.join(temporary, 'staging')
fs.mkdirSync(temporary); fs.mkdirSync(privateDir); fs.mkdirSync(staging)
var prefix = '/home/owner/share/tmp/sdk_tools/', servers = {}, service = { exports: {} }, finished = false
function mapped(filename) { return typeof filename === 'string' && filename.indexOf(prefix) === 0 ? path.join(staging, filename.slice(prefix.length)) : filename }
var storage = Object.create(fs)
;['writeFileSync', 'readFileSync', 'statSync', 'chmodSync', 'unlinkSync', 'existsSync'].forEach(function (name) {
  storage[name] = function () { var args = Array.prototype.slice.call(arguments); args[0] = mapped(args[0]); return fs[name].apply(fs, args) }
})
storage.renameSync = function (from, to) { return fs.renameSync(mapped(from), mapped(to)) }
var network = Object.create(http)
network.createServer = function (handler) {
  var server = http.createServer(handler), listen = server.listen
  server.listen = function (port) { servers[port] = server; return listen.call(server, 0, '127.0.0.1') }
  return server
}
function finish(error) {
  if (finished) return
  finished = true; clearTimeout(deadline)
  if (service.exports.onStop) service.exports.onStop()
  ;[privateDir, staging].forEach(function (directory) {
    fs.readdirSync(directory).forEach(function (name) { fs.unlinkSync(path.join(directory, name)) }); fs.rmdirSync(directory)
  })
  fs.rmdirSync(temporary)
  if (error) { console.error(error.stack || error); process.exitCode = 1 }
  else console.log('Node 4.4.3 packaged service: startup, authentication, partial upload, decryption and signed receipt passed.')
}
var deadline = setTimeout(function () { finish(new Error('Legacy service check timed out')) }, 30000)
function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }
function get(port, route, token) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: servers[port].address().port, path: route, headers: token ? { Authorization: 'Bearer ' + token } : {} }, function (response) {
      var body = ''; response.on('data', function (chunk) { body += chunk }); response.on('error', reject)
      response.on('end', function () { try { resolve({ status: response.statusCode, value: JSON.parse(body) }) } catch (error) { reject(error) } })
    }).on('error', reject)
  })
}
function waitForSetup() {
  var receipt = path.join(staging, 'izumi-updater-receipt.json')
  if (fs.existsSync(receipt)) {
    var state = JSON.parse(fs.readFileSync(receipt, 'utf8'))
    if (state.stage === 'error') throw new Error(state.message)
  }
  if (servers[18764] && servers[18764].address()) return get(18764, '/public')
  if (finished) throw new Error('Setup did not start')
  return delay(50).then(waitForSetup)
}
try {
  var context = {
    module: service, exports: service.exports, __dirname: path.dirname(bundle), __filename: bundle,
    require: function (name) { return name === 'fs' ? storage : name === 'http' ? network : require(name) },
    Buffer: Buffer, process: process, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval, setImmediate: setImmediate, clearImmediate: clearImmediate,
    tizen: {
      filesystem: { resolve: function (_name, resolve) { resolve({ toURI: function () { return 'file://' + privateDir } }) } },
      application: { getAppInfo: function (id) { return { version: id === 'IzumiUP001.Updater' ? '0.2.36' : '0.2.35' } } }
    }
  }
  context.global = context
  vm.runInNewContext(fs.readFileSync(bundle, 'utf8'), context, { filename: bundle })
  service.exports.onStart()
  var handshake, complete
  waitForSetup().then(function (result) {
    assert.equal(result.status, 200); handshake = result.value
    var key = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(handshake.challenge))
    // Deliberately incomplete identity: reaching its validation proves decryption worked.
    var encrypted = Buffer.concat([cipher.update(JSON.stringify({ challenge: handshake.challenge, certificate: {} })), cipher.final()])
    complete = JSON.stringify({ schema: 1, framing: 'lf', challenge: handshake.challenge, key: crypto.publicEncrypt({ key: handshake.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }) + '\n'
    fs.writeFileSync(path.join(staging, 'izumi-updater-setup.json'), complete.slice(0, 30))
    return delay(750)
  }).then(function () {
    assert(fs.existsSync(path.join(staging, 'izumi-updater-setup.json')), 'Partial transfer was consumed')
    fs.writeFileSync(path.join(staging, 'izumi-updater-setup.json'), complete.slice(0, -1))
    return delay(750)
  }).then(function () {
    assert(fs.existsSync(path.join(staging, 'izumi-updater-setup.json')), 'Transfer was consumed before the final newline')
    fs.writeFileSync(path.join(staging, 'izumi-updater-setup.json'), complete)
    return delay(750)
  }).then(function () { return get(18764, '/receipt') }).then(function (result) {
    assert.equal(result.status, 200)
    var receipt = result.value
    assert(crypto.createVerify('RSA-SHA256').update(receipt.state).verify(handshake.publicKey, Buffer.from(receipt.signature, 'base64')))
    var state = JSON.parse(receipt.state)
    assert.equal(state.stage, 'setup-error')
    assert(/Samsung signing identity is incomplete/.test(state.message), state.message)
    assert(!fs.existsSync(path.join(privateDir, 'samsung-identity.json')))
    return get(18763, '/state')
  }).then(function (result) {
    assert.equal(result.status, 403)
    return get(18763, '/state', fs.readFileSync(path.join(privateDir, 'api-token'), 'utf8'))
  }).then(function (result) { assert.equal(result.status, 200); finish() }).catch(finish)
} catch (error) { finish(error) }
