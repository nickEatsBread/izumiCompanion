const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

class InstallationLog {
  constructor(directory) {
    this.directory = directory
    this.filename = path.join(directory, `izumi-installation-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.log`)
    this.lines = []
  }
  append(entry) {
    const line = `[${new Date(entry.at).toISOString()}] [${entry.type}] ${entry.text}\n`
    this.lines.push(line)
    try {
      fs.mkdirSync(this.directory, { recursive: true })
      fs.appendFileSync(this.filename, line, { encoding: 'utf8', mode: 0o600 })
    } catch { /* Keep logs available to copy/save even when the app-data drive is full. */ }
  }
  text() { return this.lines.join('') }
}

module.exports = { InstallationLog }
