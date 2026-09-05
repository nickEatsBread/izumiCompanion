const test = require('node:test')
const assert = require('node:assert/strict')
const { localAddresses, connectToTV } = require('../runtime/tv-connection.cjs')
const interfaces = {
  lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  wlan: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }, { family: 'IPv6', internal: false, address: '2001:db8::1' }],
  alias: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }],
  unconfigured: [{ family: 'IPv4', internal: false, address: '169.254.1.2' }],
}
test('connection candidates contain only loopback and addresses owned by the TV', () => {
  assert.deepEqual(localAddresses(interfaces), ['127.0.0.1', '192.0.2.10'])
})
test('a successful loopback handshake avoids opening another developer connection', async () => {
  const calls = [], client = {}
  assert.equal(await connectToTV({ connect: async address => { calls.push(address); return client } }, interfaces), client)
  assert.deepEqual(calls, ['127.0.0.1'])
})
test('a rejected loopback handshake retries the TV network interface', async () => {
  const calls = [], client = {}
  assert.equal(await connectToTV({ connect: async address => { calls.push(address); if (address === '127.0.0.1') throw Error('Connection closed'); return client } }, interfaces), client)
  assert.deepEqual(calls, ['127.0.0.1', '192.0.2.10'])
  await assert.rejects(connectToTV({ connect: async () => { throw Error('Connection closed') } }, interfaces), /Loopback: Connection closed TV network: Connection closed/)
})
