<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/svg/izumi-companion-lockup-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="brand/svg/izumi-companion-lockup-light.svg">
    <img src="brand/svg/izumi-companion-lockup-light.svg" alt="izumi companion" width="420">
  </picture>

### Your izumi library, made for the big screen.

Browse your library, continue an episode, and watch on your Samsung TV.

[![Samsung Tizen](https://img.shields.io/badge/Samsung%20Tizen-2.3%2B-1428A0?style=for-the-badge&logo=samsung&logoColor=white)](#what-you-need)
[![Preact](https://img.shields.io/badge/Preact-TV%20UI-673AB8?style=for-the-badge&logo=preact&logoColor=white)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#development)
[![MIT](https://img.shields.io/badge/License-MIT-5CEAD8?style=for-the-badge)](LICENSE)

[Download the installer](https://github.com/nickEatsBread/izumiCompanion/releases/latest) · [Installation](#installation) · [Updates](#updates) · [Troubleshooting](#troubleshooting)
</div>

## What you can do

- Browse series, movies, seasons, episodes and related titles with your TV remote.
- Pick up where you left off with Continue Watching and episode progress.
- Choose sources, audio tracks and subtitles, and control playback with Samsung AVPlay.
- Pair with izumi using a QR code or short pairing code.
- Get new Companion versions through an in-app update prompt.

Companion plays content from your paired izumi device or configured sources. It does not include
or provide a media catalogue of its own.

## What you need

- A **Samsung Tizen TV running Tizen 2.3 or newer**.
- A Windows, macOS or Linux computer, or an Android/iPhone installer, on the **same local network** as the TV. The iPhone IPA needs signing through a sideloading tool.
- A **Samsung account** for first-time installation.
- izumi on your phone or computer to pair with the TV.

Updates directly on the TV require **Tizen 3.0 or newer with Web service support**. On older TVs,
install Companion without the updater and use the desktop installer for future updates.

## Installation

### 1. Download the installer

Open the [latest release](https://github.com/nickEatsBread/izumiCompanion/releases/latest) and
download **izumi Companion Installer** for your computer:

| Computer | File to choose |
| --- | --- |
| Windows | `izumi-Companion-Installer-…-Windows.exe` |
| macOS with Apple silicon | `izumi-Companion-Installer-…-arm64.dmg` |
| macOS with an Intel processor | `izumi-Companion-Installer-…-x64.dmg` |
| Linux | `izumi-Companion-Installer-…-Linux.AppImage` |

Open the installer. On Linux, allow the AppImage to run as a program first.
The installer downloads the TV packages for you; you do not need to upload or choose a WGT file.

Android and iPhone installer builds are available through the [mobile build workflow](https://github.com/nickEatsBread/izumiCompanion/actions/workflows/mobile.yml). Android builds are testing APKs; iPhone builds are unsigned IPAs for signing with a sideloading tool. See [mobile setup and build details](mobile/README.md).

### Cloudflare setup

Choose **Set up Cloudflare** in the installer to link the TV's sources with native one-click deployment. Enter the code shown in Companion, approve the matching number on the TV, choose your sources, and deploy. Claim the temporary Cloudflare account before the expiry shown in the wizard.

You can also use [TV Link](https://tv-link.izumi.watch) in a browser with a Cloudflare API token. Updated Android izumi builds can open the TV's QR invitation directly in the app. The website's **Open in izumi** button provides an app handoff on other platforms, with browser setup available if the app is absent.

### 2. Prepare your TV

1. On the TV, open **Apps** or **Apps Settings**, then enter **12345** with the remote’s number keypad.
2. Turn **Developer Mode** on. Set **Host PC IP** to the computer address shown in the installer.
   Active Wi-Fi/Ethernet addresses appear first. Choose the address on the same network as your TV.
3. Confirm, then restart the TV: hold the remote’s **Power button for at least 5 seconds**.
   If the TV stays off, press Power again to turn it on.
4. Find the TV’s IP address under **Network Status → IP Settings**.

See Samsung’s [TV connection guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)
if your TV’s menus differ.

### 3. Connect and install

1. Enter the **TV’s IP address** in the installer and choose **Connect TV**.
2. Keep **Updates on your TV** selected on supported TVs, then choose **Install on TV**.
3. Complete Samsung sign-in when prompted. The installer downloads, verifies, signs and installs
   izumi Companion and the selected updater. Keep your TV on and the installer open.
4. When **izumi Updater** opens on the TV, enter its **Desktop setup code** in the installer.
   Wait for confirmation that setup has finished.

If you chose Companion only, skip the next section and open **izumi companion** from TV Apps.

### 4. Enable updates on the TV

After the installer confirms setup:

1. Return to **Apps → 12345** on the TV.
2. Change Developer Mode **Host PC IP** to **127.0.0.1**.
3. Hold the remote’s **Power button for at least 5 seconds** to restart. If it stays off, press Power again.
4. Open **izumi companion** from TV Apps and pair it with izumi using the QR code or pairing code.

Keep the Samsung signing identity saved by the installer. Future updates use the same identity
to replace the existing app and retain its pairing, library settings and playback progress.

## Updates

Companion checks [GitHub Releases](https://github.com/nickEatsBread/izumiCompanion/releases) for
new versions. When an update is available, choose **Update now** in the popup. izumi Updater opens,
downloads and verifies the release, installs it with progress shown on screen, then returns to Companion.

You can also open **izumi Updater** from TV Apps or choose **Settings → App updates** in Companion.
Opening the updater directly lets you check and start an update yourself; choose **Open izumi** when
it finishes. Keep the TV on while an update is installing.

On TVs without the updater, install the new version using the desktop installer.
Use the desktop installer to update or repair the updater itself as well.

## Troubleshooting

### The installer cannot connect

Check that both devices are on the same network, Developer Mode is enabled, and **Host PC IP**
matches your computer’s current Wi-Fi/Ethernet address. Restart the TV after changing it by holding
**Power for at least 5 seconds**, then pressing Power again if it stays off. Having Companion open
alone does not enable the developer connection used for installation.

If you previously enabled on-TV updates, change Host PC IP from **127.0.0.1** back to the computer’s
address before restarting and reconnecting. After setup finishes, restore **127.0.0.1** and restart again.

### Installation failed

Choose **View installation logs** below the error. The logs include Samsung’s installation output
and error codes. **Copy logs** or **Save logs…** includes the full session and earlier attempts.
Use **Open saved logs** to find logs after closing and reopening the installer.

If your TV does not support the separate updater, turn off **Updates on your TV** and install Companion only.

### Samsung signing identity is missing

Restore the original installer signing-identity backup before upgrading an existing installation.
The installer keeps it in its application-data folder under `izumi-tv-installer/samsung-certificates`.
Do not share these files or include them in bug reports.

For other problems, [open an issue](https://github.com/nickEatsBread/izumiCompanion/issues) with your
TV model, Tizen version, Companion version and relevant installation logs.

## Development

See the [development and release guide](docs/development.md) for local previews, builds, tests and
GitHub Actions releases. The [updater technical notes](docs/tv-updater.md) describe signing,
setup and hardware verification.

## License

Companion is [MIT licensed](LICENSE). The desktop installer, separate TV updater and shared signing
runtime are [AGPL-3.0-or-later](updater/LICENSE). Bundled libraries, fonts and icons retain their own
licenses; see [Companion notices](THIRD-PARTY-NOTICES.md) and [updater notices](updater/THIRD-PARTY-NOTICES.md).

Samsung and Tizen are trademarks of Samsung Electronics.
