# izumi Companion installer for Android and iPhone

Install Companion and its updater on a Samsung Tizen TV from your phone. The app shares the desktop installer's release verification, direct TV transport, Samsung signing, updater setup, and installation logs.

Keep the phone and TV on the same network. Enable TV Developer Mode and use the phone address shown in the installer as Host PC IP. Restart the TV by holding the remote's Power button for at least five seconds; press it again if the TV stays off. Connect, install, complete Samsung sign-in, and enter the updater's verification code when prompted.

**Set up Cloudflare** opens the TV setup wizard with native one-click deployment. It also accepts an API token for an existing Cloudflare account. After one-click deployment, claim the temporary account before the expiry shown in the wizard. Keep the app in the foreground while installing or deploying.

The signing identity is saved in the app's private data directory, outside bundled assets, so app updates preserve it. Deleting the installer also deletes that local identity. The installer refuses to replace an existing TV app when its matching author key is unavailable. The updater on a provisioned TV keeps its own encrypted identity. Installation logs can be viewed and shared from the installer.

## Builds

The **Build mobile installer** GitHub Actions workflow builds an Android testing APK and an unsigned iPhone IPA. Android testing builds include the JavaScript bundle and run without Metro. An unsigned IPA must be signed by a sideloading tool before a standard iPhone can install it. The workflow does not use an Apple account or signing credentials.

From the repository root:

```sh
npm ci
npm ci --prefix installer
npm run assets --prefix installer
npm run cloudflare --prefix installer
npm ci --prefix mobile
node mobile/scripts/icons.cjs
npm run prepareRuntime --prefix mobile
npm run typecheck --prefix mobile
npm test --prefix mobile
```

Android requires Java 21, the Android SDK, and the NDK version declared in `android/build.gradle`. Run `android/gradlew assembleDebug` from `mobile/android` (or `gradlew.bat` on Windows). `reactNativeArchitectures` can limit a local build to `arm64-v8a` or `x86_64`.

On macOS, run `pod install` in `mobile/ios`, then build the `IzumiInstaller` workspace. Set `NODEJS_MOBILE_BUILD_NATIVE_MODULES=0`; the packaged installer dependencies are JavaScript. The iOS workflow shows the complete unsigned archive command.

Production Android signing accepts `IZUMI_ANDROID_STORE_FILE`, `IZUMI_ANDROID_STORE_PASSWORD`, `IZUMI_ANDROID_KEY_ALIAS`, and `IZUMI_ANDROID_KEY_PASSWORD` from the build environment. Signing files and credentials must remain outside Git.

The mobile host uses React Native with Node.js Mobile. Its bundled Node process handles TCP and signing; the WebView has only scoped installer or Cloudflare messages. Samsung sign-in stays in a separate WebView with no installer bridge. Android's native network API supplies active connection addresses; iPhone uses native interface enumeration.
