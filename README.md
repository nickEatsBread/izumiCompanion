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

[Features](#features) · [Local preview](#local-preview) · [Tizen build](#tizen-build)
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

## Device support

The packaged application targets **Samsung Tizen TV 2.3 and newer (2015 Samsung TVs and newer)**. AVPlay and television remote
APIs are used on-device; the local browser preview supplies equivalent UI state without pretending
to emulate Samsung's media pipeline.

Devices on the same local network can discover and cast to the receiver. Pairing stores the owner's
catalogue and preferences so the companion opens into the same library on later launches.

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
npm run build
```

The completed `dist/` directory contains the production app, `config.xml`, icon, Samsung Smart
View receiver library, legacy browser chunks, license notices, and the AVPlay bootstrap. Package
it as an unsigned Tizen widget with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-tizen.ps1
```

The resulting `artifacts/izumi-companion.wgt` must be signed for the target Samsung TV before it is
installed. Local development-TV prerequisites and the verified signing/deployment commands are in
[`AGENTS.md`](AGENTS.md); signing keys remain outside this repository.

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

[MIT](LICENSE) © izumi contributors. Bundled libraries, fonts, and icons remain under their own
licenses; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Samsung and Tizen are trademarks of Samsung Electronics. AniList, Stremio, and other service names
belong to their respective owners.
