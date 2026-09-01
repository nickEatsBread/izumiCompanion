# izumiCompanion

An unofficial companion client for izumi on Samsung Tizen TVs. The application is built with Preact, TypeScript and Vite, and uses Samsung AVPlay for playback. Its browser preview and Tizen package share the same components, focus model, pairing protocol and player state.

## Local UI preview

```powershell
cd izumiCompanion
npm install
npm run dev
```

Open `http://127.0.0.1:4173/`. Use the preview bar, mouse, or the arrow keys, Enter, and Backspace. Add `?screen=ready`, `?screen=loading`, `?screen=player`, or `?screen=error` to open a state directly.

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

The production app opens on the pairing/ready state. A companion snapshot opens the home UI; a cast request is handed to the typed AVPlay controller.

## Playback routing

The TV always asks an open paired Izumi client first. If no client acknowledges and this TV was
paired to the owner's self-hosted Worker, it can ask that same Worker for a direct source only when
the owner has explicitly enabled **Resolve TV sources in my Worker**. The TV validates the response
and gives the selected URL to AVPlay; Cloudflare never carries the media bytes.

If resolving is disabled, fails, or returns no portable source, Android can receive the existing
encrypted Web Push request. A TV without a private Worker simply asks the user to open Izumi.

## Licence

izumiCompanion is licensed under the [MIT License](LICENSE). Bundled libraries, fonts and icons
remain under their respective licences; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

This repository is an unofficial TV companion rather than the full izumi client. Samsung, Tizen
and the names of metadata or streaming services are trademarks of their respective owners.
