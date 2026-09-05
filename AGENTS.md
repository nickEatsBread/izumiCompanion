# izumi Companion agent guide

## Repository boundary

- This is the authoritative Samsung Tizen TV client repository.
- The full izumi desktop/mobile client is the sibling `anAnimeThemeForStremio` repository. Do not
  copy the TV source tree back into that repository.
- The sibling `izumi-companion` directory (with a hyphen) is legacy installer tooling, not the TV
  application source. Shared signing and transport source lives in `updater/runtime/` here.
- The desktop `installer/` is currently local work awaiting review. Do not add it to commits.
- Commit as `nickEatsBread <281274910+nickEatsBread@users.noreply.github.com>`.
- Preserve unrelated working-tree changes and commit focused changes in this repository.

## Verification and build

Run from this repository root:

```powershell
npm install
npm ci --prefix updater
npm run check
npm run build:all
powershell -ExecutionPolicy Bypass -File .\scripts\package-tizen.ps1
```

`npm run check` must pass before deployment. `npm run build` stages the complete production widget
in `dist/`. The packaging script creates the unsigned `artifacts/izumi-companion.wgt` from that
directory.

The stable Tizen identity is package `IzumiTV001`, application `IzumiTV001.IzumiTV`. Do not change
it during repository moves or branding work: changing it installs a second app and loses the
existing TV pairing/storage upgrade path.

## Deploying to the development TV

- Current updater test: deploy only `izumi-updater.wgt`. Keep Companion at 0.2.35
  so the helper can install 0.2.36. Push and GitHub publication are on hold for user review.
- Read the TV's current IPv4 address from its Network Status screen and set `IZUMI_TV_IP`
  in the local shell before running deployment commands. Never commit device addresses.
- The TV's Developer Mode Host PC IP must match the computer's active Wi-Fi/Ethernet IPv4
  address. Use the installer address list or the operating system's network settings.
- If port 26101 refuses the connection, open Apps on the TV, enter `12345`, enable Developer Mode,
  update the Host PC IP, and restart the TV before retrying. Ports 8001/8002 identify the Samsung TV
  but cannot install a widget.
- Saved TV-specific signing material is under
  `$env:APPDATA\izumi-tv-installer\samsung-certificates`. Never commit or copy it into this repo.

After packaging, install Companion without launching it:

```powershell
if (!$env:IZUMI_TV_IP) { throw 'Set IZUMI_TV_IP to the TV address from Network Status.' }
node installer\src\install-only.cjs `
  --ip "$env:IZUMI_TV_IP" `
  --package "$PWD\artifacts\izumi-companion.wgt" `
  --certificate-dir "$env:APPDATA\izumi-tv-installer\samsung-certificates"
```

That helper signs for the connected TV and verifies the installed package. It deliberately does not
launch automatically. Launch `IzumiTV001.IzumiTV` from the TV Apps screen, or use the desktop
installer UI's Launch action after installation. Confirm the TV opens the newly built pairing/home
screen before reporting deployment complete.

For Companion plus updater installation and provisioning, use `installer/src/setup-local.cjs`
from the local desktop tooling as documented in `docs/tv-updater.md`. That tooling is not yet
committed. The first transfer requires the code shown on the TV.
Do not change Developer Mode Host PC IP to loopback until provisioning has been confirmed;
doing so earlier prevents the desktop from finishing installation. Never report an end-to-end
on-TV update as tested until the loopback installation and Companion relaunch have actually run.
