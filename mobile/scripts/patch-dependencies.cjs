const fs = require('node:fs')
const path = require('node:path')
const mobile = path.resolve(__dirname, '..')
// These bridge packages predate AGP 8's mandatory namespace declaration.
// Apply reproducible build-only compatibility changes after every npm ci.
for (const [name, namespace] of [['nodejs-mobile-react-native', 'com.janeasystems.rn_nodejs_mobile']]) {
  const directory = path.join(mobile, 'node_modules', name, 'android')
  const gradle = path.join(directory, 'build.gradle')
  let source = fs.readFileSync(gradle, 'utf8')
  if (!source.includes('namespace ')) source = source.replace('android {', `android {\n    namespace '${namespace}'`)
  if (name === 'nodejs-mobile-react-native') source = source.replace("classpath 'com.android.tools.build:gradle:2.3.0'", '// Android Gradle Plugin is supplied by the host app.')
  fs.writeFileSync(gradle, source)
  const manifest = path.join(directory, 'src/main/AndroidManifest.xml')
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/\s+package="[^"]+"/, ''))
}
const plugin = path.join(mobile, 'node_modules/nodejs-mobile-react-native')
const podspec = path.join(plugin, 'nodejs-mobile-react-native.podspec')
fs.writeFileSync(podspec, fs.readFileSync(podspec, 'utf8').replace('gnu++17', 'c++20'))
for (const name of ['ios-build-native-modules.sh', 'ios-sign-native-modules.sh']) {
  const file = path.join(plugin, 'scripts', name)
  let text = fs.readFileSync(file, 'utf8')
  const guard = 'if [ "${NODEJS_MOBILE_BUILD_NATIVE_MODULES:-}" = "0" ]; then exit 0; fi'
  if (!text.includes(guard)) text = text.replace('set -e', 'set -e\n' + guard)
  fs.writeFileSync(file, text)
}
