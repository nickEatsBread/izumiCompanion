<div align="center">
  <a name="readme-top"></a>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/svg/izumi-companion-lockup-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="brand/svg/izumi-companion-lockup-light.svg">
    <img src="brand/svg/izumi-companion-lockup-light.svg" alt="izumi companion" width="420">
  </picture>

### Your izumi library, made for the big screen.

A Samsung Tizen companion for browsing and playing from a paired izumi client.

[![Samsung Tizen](https://img.shields.io/badge/Samsung%20Tizen-2.3%2B-1428A0?style=for-the-badge&logo=samsung&logoColor=white)](#device-support)
[![Preact](https://img.shields.io/badge/Preact-TV%20UI-673AB8?style=for-the-badge&logo=preact&logoColor=white)](#technology)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](#technology)
[![MIT](https://img.shields.io/badge/License-MIT-5CEAD8?style=for-the-badge)](LICENSE)

[Features](#features) · [Installation](#installation) · [Local preview](#local-preview) · [Tizen build](#tizen-build) · [Releases](#releases)
</div>

<br>
<!--
<p align="center">
  <img width="100%" alt="izumi companion Steam and Steam Deck library artwork" src="brand/steamgriddb/flat/izumi-companion-hero-1920x620.png" />
</p> -->

> [!IMPORTANT]
> izumi companion is a remote browsing and playback surface. It does not host, distribute, or
> provide media, and it is not the full izumi client. Playback comes from a paired izumi device or
> a source resolver the owner has explicitly configured.

## Features

- **TV-first browsing** — remote-friendly home, search, trending, series, movies, list, and settings screens with directional focus and smooth row transitions.
- **Rich series pages** — seasons, episodes, related titles, trailers, progress, and catalogue-aware metadata.
- **Continue watching** — landscape episode cards with playback progress and resume context.
- **Native playback** — Samsung AVPlay integration with audio, subtitle, subtitle-appearance, source, seek, and playback controls.
- **Simple pairing** — scan the on-screen QR code or enter its short pairing code from izumi on desktop.
- **Useful browser preview** — test every major state with a mouse, keyboard, or the built-in screen switcher before packaging for a television.
- **Older-TV support** — legacy JavaScript chunks, prefixed CSS, and fallbacks target the older Chromium engine used by Tizen 2.3 televisions.
- **TV update support** — a desktop installer bootstraps Companion and a separate updater, with an in-app update prompt and preserved Samsung signing identity. See [setup, release instructions and hardware verification](docs/tv-updater.md).

## Device support

The packaged application targets **Samsung Tizen TV 2.3 and newer (2015 Samsung TVs and newer)**. AVPlay and television remote
APIs are used on-device; the local browser preview supplies equivalent UI state without pretending
to emulate Samsung's media pipeline.

Devices on the same local network can discover and cast to the receiver. Pairing stores the owner's
catalogue and preferences so the companion opens into the same library on later launches.

## Installation

The desktop installer is currently available as a local test build; a public installer download has
not been published yet. Its automatic downloads require a published release containing both izumi
WGT packages. An unpublished or draft release will appear as unavailable.

You need a Samsung Tizen TV, a computer on the same local network, and a Samsung account for
first-time signing. Companion supports Tizen 2.3+; the separate updater requires Tizen 3.0+ with
Web service support. The updater has been exercised on a Tizen 4.0 TV, but its full upgrade test is
still pending. See the [hardware verification](docs/tv-updater.md#hardware-verification).

### First-time TV setup

1. Find the computer's local IPv4 address and the TV's IP address in their network settings.
2. On the TV, open **Apps** (or **Apps Settings**, depending on the model) and enter **12345** with
   the remote's number keypad. Turn **Developer Mode** on, set **Host PC IP** to the computer's
   address, confirm, and restart the TV. Samsung documents this in its
   [TV connection guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
3. Open **izumi Companion Installer** on the computer and enter the **TV's IP address**.
   Choose **Connect TV** to check the connection. On the next screen, keep **Updates on your TV**
   selected on supported TVs, then choose **Install on TV**.
4. Complete Samsung sign-in when prompted. The installer downloads, verifies, signs and installs
   Companion and its updater. You do not need to select or upload a WGT manually.
5. When **izumi Updater** opens on the TV, enter its **Desktop setup code** in the desktop installer.
   Wait for confirmation that encrypted setup succeeded. Keep a backup of the original Samsung
   signing identity; future versions must use the same identity.
6. After that confirmation, return to **Apps → 12345**, change **Host PC IP** to **127.0.0.1**,
   and restart the TV. This enables the updater to install future Companion versions on the TV.
7. Open **izumi companion** from TV Apps and pair it with izumi using the on-screen code or QR code.

For Tizen 2.3 TVs, leave **Updates on your TV** unchecked. Install Companion only and keep
Host PC IP set to the computer; the separate on-TV updater is not available on that runtime.

### Updating and reconnecting

Companion offers **Update now** when a newer published version is available. Accepting opens the
updater, displays download and installation progress, and returns to Companion after the update.
You can also open **izumi Updater** directly, or choose **Settings → App updates**, to check manually.

To repair or update the updater itself from the computer, change Developer Mode **Host PC IP** back
to the computer's address and restart the TV before running the desktop installer. After confirmed
setup, restore **127.0.0.1** and restart again. Having Companion open alone does not enable the
developer connection needed for installation.

Developer builds, signing storage and current test limitations are documented in
[TV updater setup](docs/tv-updater.md). Keep TV credentials out of public packages and source control.

## Local preview

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. Use the preview bar, mouse, or the arrow keys, Enter, and Backspace.
You can also open a state directly, for example:

```text
http://127.0.0.1:4173/?preview=1&screen=home
http://127.0.0.1:4173/?preview=1&screen=series
http://127.0.0.1:4173/?preview=1&screen=player
http://127.0.0.1:4173/?preview=1&screen=ready
```

## Tizen build

```powershell
npm ci
npm ci --prefix updater
npm run check
npm run build:all
node scripts/package-companion.mjs
node scripts/verify-release.mjs
```

The completed `dist/` directory contains the production app, `config.xml`, icon, Samsung Smart
View receiver library, legacy browser chunks, license notices, and the AVPlay bootstrap. The commands
above produce unsigned `artifacts/izumi-companion.wgt` and `artifacts/izumi-updater.wgt` packages.

The resulting `artifacts/izumi-companion.wgt` must be signed for the target Samsung TV before it is
installed. Local development-TV prerequisites and the verified signing/deployment commands are in
[`AGENTS.md`](AGENTS.md); signing keys remain outside this repository.

## Releases

[CI](.github/workflows/ci.yml) runs automatically for pushes to `main` and pull requests. It checks
types, runs the Companion and updater tests, builds both WGTs, and verifies package identities and
versions.

The [Build TV release](.github/workflows/release.yml) GitHub Actions workflow is started manually
from the Actions tab. It runs the same checks and builds, then creates a **draft GitHub release**
with both WGTs. Set matching versions in `config.xml`, `updater/config.xml`, and
`updater/package.json` and its lockfile before running it. Review the draft and publish it when ready;
the installer and TV update checks only discover complete, stable, published releases.

Desktop installer source remains local work awaiting review, so Windows, macOS and Linux installer
binaries are not currently built by this workflow. It publishes no release automatically on a push.

## Technology

- TypeScript, Preact, and Vite
- Samsung AVPlay and Smart View receiver APIs
- Lucide icons and Nunito Sans UI typography
- Vitest for receiver, pairing, playback, and compatibility coverage

## Status

izumi companion is under active development and has not yet shipped as a Samsung Store release.
The repository is intentionally separate from the full izumi client because Tizen's application
and playback constraints require a smaller, purpose-built companion.

## License

Companion is [MIT licensed](LICENSE) © izumi contributors. The separate TV updater and its shared
signing runtime are [AGPL-3.0-or-later](updater/LICENSE). Bundled libraries, fonts, and icons remain
under their own licenses; see [Companion notices](THIRD-PARTY-NOTICES.md) and
[updater notices](updater/THIRD-PARTY-NOTICES.md).

Samsung and Tizen are trademarks of Samsung Electronics. AniList, Stremio, and other service names
belong to their respective owners.
