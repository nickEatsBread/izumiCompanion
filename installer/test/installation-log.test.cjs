// Synthetic documentation addresses; no maintainer network data.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { InstallationLog } = require('../src/installation-log.cjs')
const { SamsungTransport } = require('../src/samsung.cjs')

test('all session output is saved to disk, including failed attempts and more than the UI preview limit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'izumi-log-test-'))
  const log = new InstallationLog(directory)
  try {
    for (let i = 0; i < 350; i++) log.append({ at: Date.now(), type: 'output', text: 'Samsung packet ' + i })
    log.append({ at: Date.now(), type: 'error', text: 'install failed [118012]\nCertificate rejected' })
    log.append({ at: Date.now(), type: 'info', text: 'Retry installation' })
    assert.equal(fs.readFileSync(log.filename, 'utf8'), log.text())
    assert.match(log.text(), /Samsung packet 0\n/); assert.match(log.text(), /Samsung packet 349\n/)
    assert.match(log.text(), /118012/); assert.match(log.text(), /Retry installation/)
  } finally { fs.unlinkSync(log.filename); fs.rmdirSync(directory) }
})
test('log storage failure does not interrupt setup or discard copy/save content', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'izumi-log-test-'))
  const occupied = path.join(directory, 'not-a-directory'); fs.writeFileSync(occupied, '')
  try {
    const log = new InstallationLog(occupied)
    assert.doesNotThrow(() => log.append({ at: Date.now(), type: 'error', text: 'TV connection lost' }))
    assert.match(log.text(), /TV connection lost/)
  } finally { fs.unlinkSync(occupied); fs.rmdirSync(directory) }
})
test('a TV command failure retains partial Samsung output while preserving progress callbacks', async () => {
  const entries = [], progress = []
  const transport = new SamsungTransport('direct', '192.0.2.10', (type, text) => entries.push({ type, text }), {
    command: async (_command, options) => { options.onOutput('installing 42%\nSamsung diagnostic'); throw Error('TV disconnected') },
  })
  await assert.rejects(transport.shell(['0', 'vd_appinstall', 'IzumiTV001', '/tmp/app.wgt'], { onOutput: output => progress.push(output) }), /TV disconnected/)
  assert.equal(progress.length, 1)
  assert.ok(entries.some(entry => entry.type === 'output' && entry.text.includes('Samsung diagnostic')))
  assert.ok(entries.some(entry => entry.type === 'error' && entry.text === 'TV disconnected'))
})
