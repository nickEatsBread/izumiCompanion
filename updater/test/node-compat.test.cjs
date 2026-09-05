const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(require.resolve('../runtime/node-compat.cjs'), 'utf8')

test('legacy Buffer uses byte decoding instead of inherited TypedArray.from', () => {
  function LegacyBuffer(value, encoding) { return typeof value === 'number' ? Buffer.alloc(value) : Buffer.from(value, encoding) }
  Object.setPrototypeOf(LegacyBuffer, Object.defineProperty({}, 'from', { value: Uint8Array.from, writable: false }))
  const crypto = {}, constants = { RSA_PKCS1_OAEP_PADDING: 4 }
  vm.runInNewContext(source, { Buffer: LegacyBuffer, require: name => name === 'crypto' ? crypto : constants })
  assert.equal(LegacyBuffer.from('YQ==', 'base64').toString(), 'a')
  assert.deepEqual([...LegacyBuffer.alloc(3)], [0, 0, 0])
  assert.throws(() => LegacyBuffer.from(3), /Expected bytes/)
  assert.equal(crypto.constants, constants)
})

test('modern Buffer and crypto implementations remain intact', () => {
  const from = Buffer.from, alloc = Buffer.alloc, crypto = require('node:crypto')
  vm.runInNewContext(source, { Buffer, require })
  assert.equal(Buffer.from, from)
  assert.equal(Buffer.alloc, alloc)
  assert.equal(require('node:crypto').constants, crypto.constants)
})
