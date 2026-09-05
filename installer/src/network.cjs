const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)

// Query routes as well as adapters: enumeration order often puts VMs before Wi-Fi.
const windowsNetworkQuery = `
$ErrorActionPreference = 'Stop'
$routes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
@(Get-NetAdapter | ForEach-Object {
  $adapter = $_
  $matchingRoutes = @($routes | Where-Object { $_.InterfaceIndex -eq $adapter.ifIndex })
  [pscustomobject]@{
    name = $adapter.Name
    physical = $adapter.HardwareInterface
    up = ($adapter.Status -eq 'Up')
    defaultRoute = ($matchingRoutes.Count -gt 0)
    metric = ($matchingRoutes | ForEach-Object { $_.RouteMetric + $_.InterfaceMetric } | Measure-Object -Minimum).Minimum
  }
}) | ConvertTo-Json -Compress
`
const virtualName = /virtual|vethernet|vmware|vbox|hyper-v|tailscale|vpn|tunnel|loopback|bluetooth|docker|^br-|^utun|^tun\d|^tap\d|^veth/i
const physicalName = /wi-?fi|wireless|ethernet|^en\d|^en[opsx]|^eth\d|^wlan\d|^wl[opsx]/i

function rankAddresses(interfaces, adapters = []) {
  const records = new Map(adapters.map(adapter => [adapter.name, adapter]))
  const entries = []
  for (const [name, addresses] of Object.entries(interfaces)) {
    const adapter = records.get(name)
    if (adapter?.up === false) continue
    const physical = adapter?.physical ?? (!virtualName.test(name) && physicalName.test(name))
    const rank = physical && adapter?.defaultRoute ? 0 : physical ? 1 : adapter?.defaultRoute ? 2 : 3
    for (const entry of addresses || []) {
      if (!entry || !['IPv4', 4].includes(entry.family) || entry.internal || /^(?:127\.|169\.254\.|0\.)/.test(entry.address)) continue
      entries.push({ address: entry.address, name, rank, metric: Number.isFinite(adapter?.metric) ? adapter.metric : Infinity })
    }
  }
  entries.sort((a, b) => a.rank - b.rank || a.metric - b.metric || a.name.localeCompare(b.name) || a.address.localeCompare(b.address))
  return [...new Set(entries.map(entry => entry.address))]
}

async function localAddresses({ platform = process.platform, interfaces = os.networkInterfaces(), run = execute } = {}) {
  let adapters = []
  try {
    const options = { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8' }
    if (platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(windowsNetworkQuery, 'utf16le').toString('base64')], options)
      const parsed = JSON.parse(stdout.replace(/^\uFEFF/, ''))
      adapters = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
    } else if (platform === 'darwin') {
      const { stdout } = await run('/sbin/route', ['-n', 'get', 'default'], options)
      const name = stdout.match(/interface:\s*(\S+)/)?.[1]
      if (name) adapters = [{ name, defaultRoute: true }]
    } else if (platform === 'linux') {
      const { stdout } = await run('ip', ['-j', '-4', 'route', 'show', 'default'], options)
      adapters = JSON.parse(stdout).map(route => ({ name: route.dev, defaultRoute: true, metric: route.metric || 0 }))
    }
  } catch { /* Keep usable LAN addresses available if native route discovery is unavailable. */ }
  return rankAddresses(interfaces, adapters)
}

module.exports = { localAddresses, rankAddresses }
