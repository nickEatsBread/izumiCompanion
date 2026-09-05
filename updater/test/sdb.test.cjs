const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { once } = require('node:events')
const { Sdb, packet, installationProgress } = require('../runtime/sdb.cjs')

async function fakeTv(run, rejectUpload = false) {
  const uploads = [], sockets = new Set()
  let accepted = false
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {})
    let incoming = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      incoming = Buffer.concat([incoming, chunk])
      while (incoming.length >= 24 && incoming.length >= 24 + incoming.readUInt32LE(12)) {
        const size = incoming.readUInt32LE(12), name = incoming.toString('ascii', 0, 4), local = incoming.readUInt32LE(4)
        const data = incoming.subarray(24, 24 + size); incoming = incoming.subarray(24 + size)
        if (name === 'CNXN') socket.write(packet('CNXN', 0x01000000, 4096, Buffer.from('device::test\0')))
        if (name === 'OPEN') {
          socket.write(packet('OKAY', 99, local))
          if (data.toString().startsWith('shell:')) {
            const combined = Buffer.concat([packet('WRTE', 99, local, Buffer.from('start\n')), packet('WRTE', 99, local, Buffer.from('install complete\n'))])
            socket.write(combined.subarray(0, 9)); socket.write(combined.subarray(9))
          }
        }
        if (name === 'WRTE') {
          socket.write(packet('OKAY', 99, local))
          const type = data.toString('ascii', 0, 4)
          if (type === 'DATA') uploads.push(data.subarray(8))
          if (type === 'DONE') setTimeout(() => {
            accepted = !rejectUpload
            const detail = rejectUpload ? Buffer.from('storage full') : Buffer.alloc(0)
            const header = Buffer.alloc(8); header.write(rejectUpload ? 'FAIL' : 'OKAY'); header.writeUInt32LE(detail.length, 4)
            socket.write(packet('WRTE', 99, local, Buffer.concat([header, detail])))
          }, 60)
        }
      }
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const client = await Sdb.connect('127.0.0.1', server.address().port)
  try { await run(client, uploads, () => accepted) }
  finally { client.close(); sockets.forEach((socket) => socket.destroy()); await new Promise((resolve) => server.close(resolve)) }
}
test('SDB handles fragmented and combined packets without losing the first command output', async () => {
  await fakeTv(async (client) => {
    const output = await client.command('shell:0 vd_appinstall', { completeWhen: /install complete/, timeoutMs: 2000 })
    assert.equal(output, 'start\ninstall complete\n')
  })
})
test('SDB upload waits for the TV to accept the complete file', async () => {
  await fakeTv(async (client, uploads, accepted) => {
    const bytes = Buffer.alloc(5000, 123)
    await client.push('/home/owner/share/tmp/sdk_tools/izumi-test.wgt', bytes)
    assert.equal(accepted(), true)
    assert.deepEqual(Buffer.concat(uploads), bytes)
  })
})
test('SDB rejects failed uploads instead of installing a stale staging file', async () => {
  await fakeTv(async (client) => {
    await assert.rejects(client.push('/home/owner/share/tmp/sdk_tools/izumi-test.wgt', Buffer.from('wgt')), /storage full/)
    await assert.rejects(client.push('/etc/anything', Buffer.from('wgt')), /Invalid/)
  }, true)
})
test('Samsung install percentages are used only when the TV reports a complete marker', () => {
  assert.equal(installationProgress('install start'), null)
  assert.equal(installationProgress('installing[7]\ninstalling[33'), 7)
  assert.equal(installationProgress('installing[7]\ninstalling[33]'), 33)
  assert.equal(installationProgress('installing[100]'), 100)
  assert.equal(installationProgress('installing[101]'), null)
})
