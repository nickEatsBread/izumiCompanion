'use strict'

// Samsung's developer connection uses ADB framing and the sync file protocol.
// Written for Node 4, which ships in older Samsung Web service runtimes.
var net = require('net')
var EventEmitter = require('events').EventEmitter
var util = require('util')
function bytes(value, encoding) { return Buffer.from ? Buffer.from(value, encoding) : new Buffer(value, encoding) }
function empty(size) { if (Buffer.alloc) return Buffer.alloc(size); var b = new Buffer(size); b.fill(0); return b }
function checksum(data) { var result = 0; for (var i = 0; i < data.length; i++) result = (result + data[i]) >>> 0; return result }
function packet(command, a, b, data) {
  data = data || empty(0)
  var header = empty(24)
  header.write(command, 0, 4, 'ascii')
  header.writeUInt32LE(a >>> 0, 4); header.writeUInt32LE(b >>> 0, 8)
  header.writeUInt32LE(data.length, 12); header.writeUInt32LE(checksum(data), 16)
  header.writeUInt32LE((header.readUInt32LE(0) ^ 0xffffffff) >>> 0, 20)
  return Buffer.concat([header, data])
}
function Sdb(host) {
  EventEmitter.call(this)
  this.host = host; this.nextId = 1; this.streams = {}; this.buffer = empty(0); this.ready = false
}
util.inherits(Sdb, EventEmitter)
Sdb.connect = function (host, port) {
  return new Promise(function (resolve, reject) {
    var client = new Sdb(host)
    var timer = setTimeout(function () { client.close(); reject(new Error('TV developer connection timed out. Check Developer Mode and Host PC IP.')) }, 8000)
    client.once('ready', function () { clearTimeout(timer); resolve(client) })
    client.once('failure', function (error) { clearTimeout(timer); reject(error) })
    client.socket = net.connect(port || 26101, host)
    client.socket.on('connect', function () { client.send('CNXN', 0x01000000, 4096, bytes('host::\0')) })
    client.socket.on('data', function (chunk) { try { client.receive(chunk) } catch (error) { client.fail(error) } })
    client.socket.on('error', function (error) { client.fail(error) })
    client.socket.on('close', function () { client.fail(new Error('The TV developer connection closed.')) })
  })
}
Sdb.prototype.send = function (command, a, b, data) { this.socket.write(packet(command, a, b, data)) }
Sdb.prototype.fail = function (error) {
  if (this.failed) return
  this.failed = true
  this.emit('failure', error)
  var streams = this.streams
  Object.keys(streams).forEach(function (id) { streams[id].emit('failure', error) })
  if (this.socket) this.socket.destroy()
}
Sdb.prototype.receive = function (chunk) {
  this.buffer = Buffer.concat([this.buffer, chunk])
  while (this.buffer.length >= 24) {
    var length = this.buffer.readUInt32LE(12)
    if (length > 1024 * 1024) throw new Error('Invalid SDB packet size.')
    if (this.buffer.length < 24 + length) return
    var header = this.buffer.slice(0, 24), data = this.buffer.slice(24, 24 + length)
    this.buffer = this.buffer.slice(24 + length)
    if (((header.readUInt32LE(0) ^ header.readUInt32LE(20)) >>> 0) !== 0xffffffff || checksum(data) !== header.readUInt32LE(16)) throw new Error('Invalid SDB packet checksum.')
    var command = header.toString('ascii', 0, 4), remote = header.readUInt32LE(4), local = header.readUInt32LE(8)
    if (command === 'CNXN') { this.ready = true; this.emit('ready'); continue }
    if (command === 'AUTH') throw new Error('The TV rejected this developer host. Check Host PC IP and restart the TV.')
    var stream = this.streams[local]
    if (!stream) continue
    if (command === 'OKAY') { stream.remote = remote; stream.emit('ack') }
    if (command === 'WRTE') { this.send('OKAY', local, remote); if (stream.listenerCount('data')) stream.emit('data', data); else stream.pending.push(data) }
    if (command === 'CLSE') { this.send('CLSE', local, remote); delete this.streams[local]; stream.closed = true; stream.emit('closed') }
  }
}
Sdb.prototype.open = function (command) {
  var self = this
  return new Promise(function (resolve, reject) {
    if (self.failed) return reject(new Error('TV connection is closed.'))
    var stream = new EventEmitter(); stream.local = self.nextId++; stream.remote = 0; stream.pending = []
    stream.on('newListener', function (event) {
      if (event === 'data') setImmediate(function () {
        var pending = stream.pending; stream.pending = []
        pending.forEach(function (chunk) { stream.emit('data', chunk) })
        if (stream.closed) stream.emit('closed')
      })
    })
    self.streams[stream.local] = stream
    var timer = setTimeout(function () { cleanup(); self.end(stream); reject(new Error('TV stream timed out.')) }, 8000)
    function cleanup() { clearTimeout(timer); stream.removeListener('failure', failure); stream.removeListener('closed', failure) }
    function failure(error) { cleanup(); reject(error instanceof Error ? error : new Error('TV refused the command.')) }
    stream.once('failure', failure); stream.once('closed', failure)
    stream.once('ack', function () { cleanup(); resolve(stream) })
    self.send('OPEN', stream.local, 0, bytes(command + '\0'))
  })
}
Sdb.prototype.end = function (stream) {
  if (!this.streams[stream.local]) return
  this.send('CLSE', stream.local, stream.remote)
  delete this.streams[stream.local]
}
Sdb.prototype.write = function (stream, data) {
  var self = this
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { finish(new Error('The TV did not acknowledge an upload packet.')) }, 15000)
    function finish(error) { clearTimeout(timer); stream.removeListener('ack', ack); stream.removeListener('failure', finish); stream.removeListener('closed', closed); if (error) reject(error); else resolve() }
    function ack() { finish() }
    function closed() { finish(new Error('TV closed the upload stream.')) }
    stream.once('ack', ack); stream.once('failure', finish); stream.once('closed', closed)
    self.send('WRTE', stream.local, stream.remote, data)
  })
}
Sdb.prototype.command = function (command, options) {
  var self = this; options = options || {}
  return self.open(command).then(function (stream) {
    return new Promise(function (resolve, reject) {
      var output = '', idle
      var timer = setTimeout(function () { finish(new Error('TV command timed out: ' + command)) }, options.timeoutMs || 120000)
      var settled = false
      function finish(error) {
        if (settled) return
        settled = true; clearTimeout(timer); clearTimeout(idle); self.end(stream)
        if (error) reject(error); else resolve(output)
      }
      stream.on('failure', finish)
      stream.on('data', function (data) {
        output += data.toString(); clearTimeout(idle)
        if (output.length > 4 * 1024 * 1024) return finish(new Error('TV command output exceeds the limit.'))
        if (options.onOutput) options.onOutput(output)
        if (options.completeWhen && options.completeWhen.test(output)) finish()
        else if (!options.completeWhen) idle = setTimeout(function () { finish() }, options.idleAfterDataMs || 600)
      })
      stream.on('closed', function () {
        if (options.completeWhen && !options.completeWhen.test(output)) finish(new Error('TV command ended before completion: ' + output.trim()))
        else finish()
      })
    })
  })
}
function syncFrame(name, value) { var header = empty(8); header.write(name, 0, 4, 'ascii'); header.writeUInt32LE(value, 4); return header }
Sdb.prototype.push = function (remotePath, data, progress) {
  var self = this
  if (!/^\/home\/owner\/share\/tmp\/sdk_tools\/[a-zA-Z0-9._-]+$/.test(remotePath)) return Promise.reject(new Error('Invalid TV staging path.'))
  return self.open('sync:').then(function (stream) {
    var response = empty(0), uploadError, completed = false
    stream.on('failure', function (error) { uploadError = error })
    stream.on('closed', function () { if (!completed) uploadError = new Error('TV closed the file upload before accepting it.') })
    stream.on('data', function (chunk) { response = Buffer.concat([response, chunk]) })
    var destination = bytes(remotePath + ',33152') // regular file, owner read/write only
    return self.write(stream, Buffer.concat([syncFrame('SEND', destination.length), destination])).then(function () {
      var offset = 0
      function next() {
        if (uploadError) throw uploadError
        if (offset >= data.length) return
        var chunk = data.slice(offset, offset + 1420)
        return self.write(stream, Buffer.concat([syncFrame('DATA', chunk.length), chunk])).then(function () {
          offset += chunk.length; if (progress) progress(offset, data.length); return next()
        })
      }
      return next()
    }).then(function () { return self.write(stream, syncFrame('DONE', Math.floor(Date.now() / 1000))) }).then(function () {
      return new Promise(function (resolve, reject) {
        var started = Date.now()
        function check() {
          if (uploadError) return reject(uploadError)
          if (response.length >= 8) {
            var status = response.toString('ascii', 0, 4), length = response.readUInt32LE(4)
            if (status === 'OKAY' && length === 0) { completed = true; return resolve() }
            if (status === 'FAIL' && response.length >= 8 + length) return reject(new Error('TV upload failed: ' + response.toString('utf8', 8, 8 + length)))
            if (length > 65536 || (status !== 'OKAY' && status !== 'FAIL')) return reject(new Error('Invalid TV upload response.'))
          }
          if (Date.now() - started > 15000) return reject(new Error('TV did not confirm the uploaded file.'))
          setTimeout(check, 25)
        }
        check()
      })
    }).then(function () { self.send('WRTE', stream.local, stream.remote, syncFrame('QUIT', 0)); self.end(stream) }, function (error) { self.end(stream); throw error })
  })
}
Sdb.prototype.pull = function (remotePath, limit) {
  var self = this; limit = limit || 1024 * 1024
  if (!/^\/home\/owner\/share\/tmp\/sdk_tools\/izumi-updater-[a-z.-]+$/.test(remotePath)) return Promise.reject(new Error('Invalid setup receipt path.'))
  return self.open('sync:').then(function (stream) {
    return new Promise(function (resolve, reject) {
      var pending = empty(0), chunks = [], total = 0, settled = false
      var timer = setTimeout(function () { finish(new Error('TV setup receipt timed out.')) }, 8000)
      function finish(error) { if (settled) return; settled = true; clearTimeout(timer); self.end(stream); if (error) reject(error); else resolve(Buffer.concat(chunks)) }
      stream.on('failure', finish)
      stream.on('closed', function () { finish(new Error('TV setup receipt ended early.')) })
      stream.on('data', function (data) {
        pending = Buffer.concat([pending, data])
        while (pending.length >= 8) {
          var type = pending.toString('ascii', 0, 4), size = pending.readUInt32LE(4)
          if (type === 'DONE') return finish()
          if (size > limit || total + size > limit) return finish(new Error('TV setup receipt exceeds the size limit.'))
          if (pending.length < 8 + size) return
          var value = pending.slice(8, 8 + size); pending = pending.slice(8 + size)
          if (type === 'FAIL') return finish(new Error('TV setup file unavailable: ' + value.toString()))
          if (type !== 'DATA') return finish(new Error('Invalid TV setup receipt.'))
          chunks.push(value); total += size
        }
      })
      var filename = bytes(remotePath)
      self.write(stream, Buffer.concat([syncFrame('RECV', filename.length), filename])).catch(finish)
    })
  })
}
Sdb.prototype.close = function () { if (this.socket) this.socket.destroy() }
function installationProgress(output) {
  var pattern = /\binstalling\[(\d{1,3})\]/g, match, result = null
  while ((match = pattern.exec(output))) { var value = Number(match[1]); if (value >= 0 && value <= 100) result = value }
  return result
}
module.exports = { Sdb: Sdb, packet: packet, installationProgress: installationProgress }
