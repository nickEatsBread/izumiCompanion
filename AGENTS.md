# izumi Companion agent guide

## Repository boundary

- This is the authoritative Samsung Tizen TV client repository.
- The full izumi desktop/mobile client is the sibling `anAnimeThemeForStremio` repository. Do not
  copy the TV source tree back into that repository.
- The sibling `izumi-companion` directory (with a hyphen) is legacy installer tooling, not the TV
  application source. Its tested signing/transport code is currently used for local physical-TV
  deployment.
- Preserve unrelated working-tree changes and commit focused changes in this repository.

## Verification and build

Run from this repository root:

```powershell
npm install
npm run check
npm run build
powershell -ExecutionPolicy Bypass -File .\scripts\package-tizen.ps1
```

`npm run check` must pass before deployment. `npm run build` stages the complete production widget
in `dist/`. The packaging script creates the unsigned `artifacts/izumi-companion.wgt` from that
directory.

The stable Tizen identity is package `IzumiTV001`, application `IzumiTV001.IzumiTV`. Do not change
it during repository moves or branding work: changing it installs a second app and loses the
existing TV pairing/storage upgrade path.

## Deploying to the development TV

- Last-known TV address: `192.0.2.30`.
- The TV's Developer Mode Host PC IP must match this workstation's current Wi-Fi IPv4 address
  (`Get-NetIPAddress -InterfaceAlias 'Wi-Fi' -AddressFamily IPv4`). The last-known value is
  `192.0.2.20`; do not assume it is permanent.
- If port 26101 refuses the connection, open Apps on the TV, enter `12345`, enable Developer Mode,
  update the Host PC IP, and restart the TV before retrying. Ports 8001/8002 identify the Samsung TV
  but cannot install a widget.
- Saved TV-specific signing material is under
  `$env:APPDATA\izumi-tv-installer\samsung-certificates`. Never commit or copy it into this repo.

After packaging, install with the tested local installer helper:

```powershell
npm --prefix ..\izumi-companion\installer run install-only -- `
  --ip 192.0.2.30 `
  --package "$PWD\artifacts\izumi-companion.wgt" `
  --certificate-dir "$env:APPDATA\izumi-tv-installer\samsung-certificates"
```

That helper signs for the connected TV and verifies the installed package. It deliberately does not
launch automatically. Launch `IzumiTV001.IzumiTV` from the TV Apps screen, or use the legacy
installer UI's Launch action after installation. Confirm the TV opens the newly built pairing/home
screen before reporting deployment complete.
