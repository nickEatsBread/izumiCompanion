'use strict'
// Old Node Buffers inherit TypedArray.from, whose second argument is a callback.
// Only a Buffer-owned implementation understands string encodings.
if (!Object.prototype.hasOwnProperty.call(Buffer, 'from')) {
  // Node 4's inherited property is read-only, so assignment cannot shadow it.
  Object.defineProperty(Buffer, 'from', { configurable: true, writable: true, value: function (value, encoding) {
    if (typeof value === 'number') throw new TypeError('Expected bytes')
    return new Buffer(value, encoding)
  } })
}
if (!Buffer.alloc) Buffer.alloc = function (size) { var bytes = new Buffer(size); bytes.fill(0); return bytes }
if (!Buffer.allocUnsafe) Buffer.allocUnsafe = function (size) { return new Buffer(size) }
if (!require('crypto').constants) require('crypto').constants = require('constants')
