// Synthetic documentation addresses; no maintainer network data.
const test = require('node:test')
const assert = require('node:assert/strict')
const { localAddresses, rankAddresses } = require('../src/network.cjs')
const ipv4 = address => ({ address, family: 'IPv4', internal: false })

test('active physical default routes come before VPNs, VMs and other LAN adapters, ordered by metric', () => {
  const interfaces = { 'VMware VMnet8': [ipv4('198.51.100.10')], Tailscale: [ipv4('100.64.0.1')], Ethernet: [ipv4('192.0.2.40')], 'Wi-Fi': [ipv4('192.0.2.20')], 'Ethernet 2': [ipv4('198.51.100.20')] }
  const adapters = [
    { name: 'Wi-Fi', physical: true, up: true, defaultRoute: true, metric: 50 },
    { name: 'Ethernet', physical: true, up: true, defaultRoute: true, metric: 25 },
    { name: 'Ethernet 2', physical: true, up: true, defaultRoute: false },
    { name: 'Tailscale', physical: false, up: true, defaultRoute: true, metric: 1 },
    { name: 'VMware VMnet8', physical: false, up: true },
  ]
  assert.deepEqual(rankAddresses(interfaces, adapters), ['192.0.2.40', '192.0.2.20', '198.51.100.20', '100.64.0.1', '198.51.100.10'])
})
test('exclude disconnected, loopback, self-assigned and IPv6 addresses; deduplicate usable addresses', () => {
  assert.deepEqual(rankAddresses({ Ethernet: [ipv4('192.0.2.30')], 'Wi-Fi': [ipv4('192.0.2.20'), ipv4('192.0.2.20'), ipv4('169.254.1.2'), ipv4('127.0.0.1'), { address: '::1', family: 'IPv6' }], Loopback: [{ ...ipv4('127.0.0.1'), internal: true }] }, [{ name: 'Ethernet', up: false }]), ['192.0.2.20'])
})
test('Windows discovery uses route data without launching a visible PowerShell window', async () => {
  const addresses = await localAddresses({ platform: 'win32', interfaces: { 'vEthernet (Default Switch)': [ipv4('203.0.113.10')], 'Network connection': [ipv4('192.0.2.20')] }, run: async (file, args, options) => {
    assert.equal(file, 'powershell.exe'); assert.ok(args.includes('-NonInteractive')); assert.equal(options.windowsHide, true); assert.ok(options.timeout <= 10_000)
    return { stdout: JSON.stringify({ name: 'Network connection', physical: true, up: true, defaultRoute: true, metric: 50 }) }
  } })
  assert.deepEqual(addresses, ['192.0.2.20', '203.0.113.10'])
})
test('discovery failures still put recognized LAN adapters before virtual interfaces', async () => {
  const addresses = await localAddresses({ platform: 'win32', interfaces: { 'VMware VMnet1': [ipv4('198.51.100.11')], 'Wi-Fi': [ipv4('192.0.2.20')] }, run: async () => { throw Error('PowerShell unavailable') } })
  assert.deepEqual(addresses, ['192.0.2.20', '198.51.100.11'])
})
test('macOS uses the default physical interface before other physical interfaces', async () => {
  assert.deepEqual(await localAddresses({ platform: 'darwin', interfaces: { en0: [ipv4('192.0.2.50')], en1: [ipv4('192.0.2.40')] }, run: async () => ({ stdout: '   interface: en1\n' }) }), ['192.0.2.40', '192.0.2.50'])
})
test('Linux prioritizes physical default routes over a lower-metric tunnel', async () => {
  assert.deepEqual(await localAddresses({ platform: 'linux', interfaces: { tun0: [ipv4('198.51.100.30')], wlan0: [ipv4('192.0.2.50')] }, run: async () => ({ stdout: JSON.stringify([{ dev: 'tun0', metric: 1 }, { dev: 'wlan0', metric: 100 }]) }) }), ['192.0.2.50', '198.51.100.30'])
})
