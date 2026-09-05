const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Sdb, installationProgress } = require('./runtime/sdb.cjs')
const completionPattern = /spend time|install failed|uninstall failed|download failed|check certificate error|invalid certificate chain|(?:^|\n)closed(?:\r?\n|$)/i

function parseVdAppList(output) {
  return String(output || '')
    .split(/-{20,}/)
    .map((entry) => entry
      .replace(/-{10,}/g, '')
      .replace(/\s+=/g, '=')
      .replace(/\r/g, '')
      .trim())
    .filter(Boolean)
    .map((entry) => {
      const app = {}
      for (const line of entry.split('\n')) {
        const separator = line.indexOf('=')
        if (separator <= 0) continue
        app[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
      }
      return app
    })
    .filter((entry) => Object.keys(entry).length > 0)
}

function executableCandidates(name) {
  const extension = process.platform === 'win32' ? '.exe' : ''
  const file = `${name}${extension}`
  const candidates = [file]
  if (process.platform === 'win32') {
    candidates.push(
      path.join('C:\\', 'tizen-studio', 'tools', file),
      path.join(process.env.LOCALAPPDATA || '', 'Samsung', 'tizen-studio', 'tools', file),
    )
  } else {
    candidates.push(path.join(os.homedir(), 'tizen-studio', 'tools', file))
  }
  return candidates.filter(Boolean)
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeoutMs || 120_000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      } else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

async function findSdb() {
  for (const candidate of executableCandidates('sdb')) {
    try {
      await capture(candidate, ['version'], { timeoutMs: 5_000 })
      return candidate
    } catch { /* try the next known installation path */ }
  }
  return null
}

function parseSdbTarget(output, ip) {
  return String(output || '').split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .find((target) => target && target !== 'List' && target.includes(ip)) || ''
}

function connectDirect(ip, log) {
  log('info', `Connecting directly to ${ip}:26101…`)
  return Sdb.connect(ip)
}

function directStream(client, command, options = {}) {
  if (client.command) return client.command(command, options)
  return new Promise((resolve, reject) => {
    const stream = client.createStream(command)
    let output = ''
    let settled = false
    let idleTimer
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(idleTimer)
      try { stream.destroy() } catch {}
      if (error) reject(error)
      else resolve(output)
    }
    const timeout = setTimeout(() => finish(new Error(`TV command timed out: ${command}`)), options.timeoutMs || 120_000)
    stream.on('data', (chunk) => {
      output += chunk.toString()
      if (options.onOutput) options.onOutput(output)
      clearTimeout(idleTimer)
      if (options.completeWhen?.test(output)) finish()
      // Long-running TV commands can be silent between their initial acknowledgement and final
      // result. When a completion marker is supplied, keep listening for it instead of treating
      // that silence as success and racing the next command.
      else if (!options.completeWhen) idleTimer = setTimeout(() => finish(), options.idleAfterDataMs || 600)
    })
    stream.on('error', finish)
    const finishFromStream = () => {
      if (options.completeWhen && !options.completeWhen.test(output)) {
        const detail = output.trim()
        finish(new Error(`TV command ended before completion: ${command}${detail ? `\n${detail}` : ''}`))
      } else finish()
    }
    stream.on('end', finishFromStream)
    stream.on('close', finishFromStream)
  })
}

class SamsungTransport {
  constructor(kind, target, log, client = null, sdb = null) {
    this.kind = kind
    this.target = target
    this.log = log
    this.client = client
    this.sdb = sdb
  }

  static async connect(ip, log) {
    let direct
    try {
      direct = await connectDirect(ip, log)
      const transport = new SamsungTransport('direct', ip, log, direct)
      await transport.shell(['0', 'getduid'], { timeoutMs: 10_000 })
      log('success', 'Connected to the TV.')
      return transport
    } catch (error) {
      try { direct?.close() } catch {}
      log('info', `Direct connection unavailable: ${error.message}. Looking for Samsung sdb…`)
    }

    const sdb = await findSdb()
    if (!sdb) throw new Error('Could not connect. Enable Developer Mode and set Host PC IP to this computer. Hold the remote’s Power button for at least 5 seconds to restart; if the TV stays off, press Power again. Then try connecting again.')
    await capture(sdb, ['connect', ip], { timeoutMs: 15_000 })
    const devices = await capture(sdb, ['devices'], { timeoutMs: 10_000 })
    const target = parseSdbTarget(devices.stdout, ip)
    if (!target) throw new Error('Samsung sdb did not list the TV after connecting.')
    log('success', 'Connected through Samsung sdb.')
    return new SamsungTransport('sdb', target, log, null, sdb)
  }

  async shell(args, options = {}) {
    const safe = args.map((value) => String(value))
    this.log('command', `TV · ${safe.join(' ')}`)
    let partialOutput = ''
    try {
      if (this.kind === 'direct') {
        const stdout = await directStream(this.client, `shell:${safe.join(' ')}`, { ...options, onOutput: output => { partialOutput = output; options.onOutput?.(output) } })
        if (stdout.trim()) this.log('output', stdout.trim())
        return stdout
      }
      const result = await capture(this.sdb, ['-s', this.target, 'shell', ...safe], options)
      if (result.stdout.trim()) this.log('output', result.stdout.trim())
      if (result.stderr.trim()) this.log('output', result.stderr.trim())
      return result.stdout
    } catch (error) {
      if (partialOutput.trim()) this.log('output', partialOutput.trim())
      if (String(error.stdout || '').trim()) this.log('output', String(error.stdout).trim())
      if (String(error.stderr || '').trim()) this.log('output', String(error.stderr).trim())
      this.log('error', error.message)
      throw error
    }
  }

  async duid() {
    const output = await this.shell(['0', 'getduid'], { timeoutMs: 10_000 })
    const value = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (!value) throw new Error('The TV did not return its device ID.')
    return value
  }

  async push(localPath, remotePath) {
    this.log('info', `Uploading ${path.basename(localPath)}…`)
    if (this.kind === 'direct') {
      await this.client.push(remotePath, fs.readFileSync(localPath))
    } else {
      await capture(this.sdb, ['-s', this.target, 'push', localPath, remotePath], { timeoutMs: 60_000 })
    }
  }

  async pushBytes(remotePath, data) {
    if (this.kind === 'direct') return this.client.push(remotePath, data)
    const temporary = path.join(os.tmpdir(), `izumi-setup-${require('node:crypto').randomBytes(12).toString('hex')}.bin`)
    fs.writeFileSync(temporary, data, { mode: 0o600 })
    try { await this.push(temporary, remotePath) } finally { fs.unlinkSync(temporary) }
  }

  async pullSetup(remotePath) {
    if (!/^\/home\/owner\/share\/tmp\/sdk_tools\/izumi-updater-(public|receipt)\.json$/.test(remotePath)) throw new Error('Invalid updater setup path.')
    if (this.kind === 'direct') return this.client.pull(remotePath, 65536)
    const temporary = path.join(os.tmpdir(), `izumi-receipt-${require('node:crypto').randomBytes(12).toString('hex')}.json`)
    try {
      await capture(this.sdb, ['-s', this.target, 'pull', remotePath, temporary], { timeoutMs: 10000 })
      if (fs.statSync(temporary).size > 65536) throw new Error('Updater receipt exceeds its size limit.')
      return fs.readFileSync(temporary)
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  }

  async install(localPath, packageId, progress) {
    // Samsung TVs expose vd_appinstall through the shell. The generic `sdb
    // install` command is intended for other Tizen profiles and is rejected by
    // older TV firmware, including the 2018 generation.
    const remotePath = `/home/owner/share/tmp/sdk_tools/${packageId}-${Date.now()}.wgt`
    await this.shell(['0', 'mkdir', '-p', '/home/owner/share/tmp/sdk_tools'], { timeoutMs: 8_000 }).catch(() => '')
    await this.push(localPath, remotePath)
    this.log('info', 'Installing the signed TV package…')
    const output = await this.shell(['0', 'vd_appinstall', packageId, remotePath], {
      timeoutMs: 180_000,
      completeWhen: completionPattern,
      onOutput: (output) => { const percent = installationProgress(output); if (progress && percent !== null) progress(percent) },
    })
    if (/install failed|check certificate error|invalid certificate chain|\berror\b/i.test(output)) {
      throw new Error(output.trim() || 'The TV rejected the package.')
    }
    const installed = await this.findInstalledApp(packageId)
    if (!installed || installed.app_package_name !== packageId) {
      throw new Error(`Samsung finished the install command, but ${packageId} was not found in the TV app registry.`)
    }
    return installed
  }

  async launch(appId) {
    const installed = await this.findInstalledApp(appId)
    if (!installed) throw new Error(`${appId} is not installed on this TV.`)
    const launchId = installed.app_id || installed.app_tizen_id || appId
    const output = await this.shell(['0', 'was_execute', launchId], { timeoutMs: 20_000 })
    if (/failed|error/i.test(output)) throw new Error(output.trim())
  }

  async findInstalledApp(...identifiers) {
    const candidates = new Set(identifiers.flat().map((value) => String(value || '').trim()).filter(Boolean))
    if (!candidates.size) return null
    const output = await this.shell(['0', 'vd_applist'], { timeoutMs: 30_000, idleAfterDataMs: 1_200 })
    return parseVdAppList(output).find((installed) => [
      installed.app_id,
      installed.app_tizen_id,
      installed.app_package_name,
      installed.app_package_id,
      installed.package_id,
    ].some((value) => candidates.has(String(value || '').trim()))) || null
  }

  async uninstall(packageId) {
    const output = await this.shell(['0', 'vd_appuninstall', packageId], {
      timeoutMs: 60_000,
      completeWhen: completionPattern,
    })
    if (/failed|error/i.test(output)) throw new Error(output.trim())
  }

  async installDeviceProfile(profilePath) {
    const remote = '/home/owner/share/tmp/sdk_tools/device-profile.xml'
    await this.shell(['0', 'mkdir', '-p', '/home/owner/share/tmp/sdk_tools'], { timeoutMs: 8_000 }).catch(() => '')
    await this.push(profilePath, remote)
  }

  close() {
    if (this.kind !== 'direct') return
    try { this.client?.close() } catch {}
  }
}

module.exports = { SamsungTransport, directStream, parseSdbTarget, parseVdAppList }
