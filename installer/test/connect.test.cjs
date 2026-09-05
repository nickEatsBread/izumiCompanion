// Synthetic documentation addresses; no maintainer network data.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
function controller(fail = false) {
  const filename = path.join(__dirname, '../src/installer-core.cjs'), realRequire = createRequire(filename)
  const calls = [], module = { exports: {} }
  const logged = []
  const transport = { findInstalledApp: async id => { calls.push(['read', id]); if (fail) throw Error('TV connection lost'); return { app_version: '0.2.35' } }, close: () => calls.push(['close']) }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, __dirname: path.dirname(filename), Buffer, process, setTimeout, clearTimeout, require: name => name === './installation-log.cjs' ? { InstallationLog: class { append(entry) { logged.push(entry) } } } : name === './samsung.cjs' ? { SamsungTransport: { connect: async (_ip, log) => { calls.push(['connect']); log('command', 'TV · 0 vd_applist'); log('output', 'Samsung registry output'); return transport } } } : name === './runtime/releases.cjs' ? { ...realRequire(name), latest: () => { throw Error('Connection checks must not download or install releases') } } : realRequire(name) }, { filename })
  return { run: module.exports.createInstaller({ userData: __dirname, onEvent() {} }).run, calls, logged }
}
test('Connect reads the installed version and releases the TV without downloading or installing', async () => {
  const { run, calls, logged } = controller()
  const result = await run({ action: 'connect', ip: '192.0.2.10' })
  assert.equal(result.installedVersion, '0.2.35')
  assert.deepEqual(calls, [['connect'], ['read', 'IzumiTV001.IzumiTV'], ['close']])
  assert.ok(logged.some(entry => entry.type === 'command'))
  assert.ok(logged.some(entry => entry.type === 'output' && entry.text === 'Samsung registry output'))
})
test('A failed connection check closes the transport and can be retried', async () => {
  const { run, calls } = controller(true)
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(run({ action: 'connect', ip: '192.0.2.10' }), /connection lost/)
  assert.equal(calls.filter(call => call[0] === 'close').length, 2)
})
