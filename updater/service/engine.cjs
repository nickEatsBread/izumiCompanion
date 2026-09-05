'use strict'
const { compareVersions } = require('../runtime/releases.cjs')

class UpdateEngine {
  constructor(dependencies) {
    this.dependencies = dependencies
    this.busy = false
    this.release = null
    this.state = { stage: 'idle', message: 'Ready to check for updates.', progress: null, installedVersion: '', latestVersion: '', updateAvailable: false, provisioned: false, returnToApp: false }
  }
  report(stage, message, progress = null) { Object.assign(this.state, { stage, message, progress }); if (this.dependencies.changed) this.dependencies.changed(this.state) }
  async check() {
    if (this.busy) throw new Error('An update operation is already running.')
    this.busy = true
    try {
      this.report('checking', 'Checking the latest izumi release…')
      const installed = await this.dependencies.installedVersion()
      this.state.installedVersion = installed || ''
      this.state.provisioned = this.dependencies.provisioned()
      this.release = await this.dependencies.latest()
      this.state.latestVersion = this.release.version
      this.state.updateAvailable = !installed || compareVersions(this.release.version, installed) > 0
      this.report('ready', this.state.updateAvailable ? 'A new version of izumi is ready.' : 'You have the latest version of izumi.')
      return this.state
    } catch (error) { this.report('error', error.message); throw error }
    finally { this.busy = false }
  }
  async update(returnToApp) {
    if (this.busy) throw new Error('An update operation is already running.')
    this.busy = true
    this.state.returnToApp = returnToApp === true
    try {
      this.report('checking', 'Checking your TV and signing identity…')
      // Re-read metadata at the moment of installation. UI never supplies an asset URL or WGT.
      await this.dependencies.preflight()
      const installed = await this.dependencies.installedVersion()
      const release = await this.dependencies.latest()
      if (installed && compareVersions(release.version, installed) <= 0) {
        this.state.installedVersion = installed; this.state.latestVersion = release.version; this.state.updateAvailable = false
        this.report('current', 'izumi is already up to date.', 100)
        if (this.state.returnToApp) await this.dependencies.launch()
        return this.state
      }
      this.state.latestVersion = release.version
      this.report('downloading', 'Downloading izumi Companion…', 0)
      const bytes = await this.dependencies.download(release.packages.companion, (received, total) => {
        this.report('downloading', 'Downloading izumi Companion…', total ? Math.min(100, Math.floor(received / total * 100)) : null)
      })
      this.report('signing', 'Verifying and signing for this TV…')
      const signed = await this.dependencies.sign(bytes, release.version)
      this.report('installing', 'Installing izumi. Keep the TV on…')
      await this.dependencies.install(signed, (received, total) => this.report('uploading', 'Sending the signed update to the TV installer…', Math.floor(received / total * 100)), (percent) => this.report('installing', 'Installing izumi. Keep the TV on…', typeof percent === 'number' ? percent : null))
      this.report('verifying', 'Confirming the installed version…')
      const actual = await this.dependencies.installedVersion()
      if (actual !== release.version) throw new Error('Samsung did not confirm the expected version. Open izumi to check it, or use the desktop installer to repair the installation.')
      this.state.installedVersion = actual; this.state.updateAvailable = false
      this.report('complete', 'izumi has been updated.', 100)
      if (this.state.returnToApp) {
        try { await this.dependencies.launch() }
        catch (error) { this.report('complete', 'Update installed. Select Open izumi to launch it.', 100) }
      }
      return this.state
    } catch (error) { this.report('error', error.message); throw error }
    finally { this.busy = false; if (this.dependencies.close) this.dependencies.close() }
  }
}
module.exports = { UpdateEngine }
