const fsp = require('node:fs/promises')
const path = require('node:path')
const { readWidget, signWidget } = require('./runtime/widget.cjs')
async function signPackage(packagePath, certificate, outputDirectory) {
  const bytes = await fsp.readFile(packagePath)
  let kind = 'companion'
  try { await readWidget(bytes, kind) }
  catch (error) {
    if (!/expected izumi application identity/.test(error.message)) throw error
    kind = 'updater'
    await readWidget(bytes, kind)
  }
  const signed = await signWidget(bytes, certificate, kind)
  await fsp.mkdir(outputDirectory, { recursive: true })
  const destination = path.join(outputDirectory, `izumi-${kind}-signed-${Date.now()}.wgt`)
  await fsp.writeFile(destination, signed.bytes, { mode: 0o600 })
  return destination
}
module.exports = { signPackage }
