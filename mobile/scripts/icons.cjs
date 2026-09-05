const fs = require('node:fs')
const path = require('node:path')
const sharp = require('../../node_modules/sharp')
const root = path.resolve(__dirname, '..')
const icon = path.join(root, '../installer/assets/icon.png')
async function main() {
  for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const directory = path.join(root, 'android/app/src/main/res', 'mipmap-' + density)
    fs.mkdirSync(directory, { recursive: true })
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) await sharp(icon).resize(size, size).png().toFile(path.join(directory, name))
  }
  const directory = path.join(root, 'ios/IzumiInstaller/Images.xcassets/AppIcon.appiconset')
  await sharp(icon).resize(1024, 1024).flatten({ background: '#0c0e10' }).png().toFile(path.join(directory, 'icon.png'))
  fs.writeFileSync(path.join(directory, 'Contents.json'), JSON.stringify({ images: [{ filename: 'icon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n')
  const launch = path.join(root, 'ios/IzumiInstaller/Images.xcassets/LaunchIcon.imageset')
  fs.mkdirSync(launch, { recursive: true })
  await sharp(icon).resize(300, 300).png().toFile(path.join(launch, 'icon.png'))
  fs.writeFileSync(path.join(launch, 'Contents.json'), JSON.stringify({ images: [{ filename: 'icon.png', idiom: 'universal' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
