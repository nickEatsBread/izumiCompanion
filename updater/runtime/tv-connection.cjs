'use strict'
const os = require('os')
function localAddresses(interfaces) {
  const addresses = ['127.0.0.1']
  for (const name of Object.keys(interfaces)) for (const network of interfaces[name] || []) {
    if (network.internal || network.family !== 'IPv4' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(network.address) || /^(0\.|127\.|169\.254\.)/.test(network.address)) continue
    if (addresses.indexOf(network.address) < 0) addresses.push(network.address)
  }
  return addresses
}
async function connectToTV(Sdb, interfaces) {
  if (!interfaces) { try { interfaces = os.networkInterfaces() } catch (_) { interfaces = {} } }
  const addresses = localAddresses(interfaces), failures = []
  for (const address of addresses) {
    try { return await Sdb.connect(address) }
    catch (error) { failures.push((address === '127.0.0.1' ? 'Loopback: ' : 'TV network: ') + error.message) }
  }
  throw new Error(failures.join(' '))
}
module.exports = { localAddresses, connectToTV }
