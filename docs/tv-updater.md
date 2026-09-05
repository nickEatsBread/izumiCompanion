# Desktop installer and TV updater

The Companion and separate TV updater are maintained here. Shared signing,
release verification and Samsung transport code lives in `updater/runtime/`.
The desktop `installer/` remains local, uncommitted work awaiting review; TV
builds and checks do not depend on it.

## User flow

1. Open the desktop installer with the computer and TV on the same network.
   Enable Developer Mode in TV Apps (`12345`), set Host PC IP to the computer,
   restart the TV and enter its IP in the installer.
2. The installer downloads `izumi-companion.wgt` and `izumi-updater.wgt` from
   the latest stable release of `nickEatsBread/izumiCompanion`. No WGT chooser is
   needed. Companion-only installation remains available for older TVs.
   **Connect TV** checks the connection and installed Companion version first,
   without downloading or installing. **Install on TV** starts the selected setup.
3. Samsung sign-in creates the TV-specific author/distributor identity on the
   first installation. Later installs preserve it. If an existing installation
   has no matching saved identity, the installer asks for the original backup
   rather than silently creating a different author key.
4. The installer verifies the release SHA-256 digests, package identities and
   versions, signs each WGT, installs it, and checks Samsung's app registry.
5. The updater opens on the TV. On first setup, enter its twelve-character
   **Desktop setup code** in the desktop installer. This verifies the updater's
   public encryption key. The installer pins the verified key for later repairs.
6. The desktop sends an encrypted signing-identity envelope over the TV's developer
   connection. The updater saves the decrypted identity in private app storage
   and returns a signed receipt that the installer verifies.
7. Set Developer Mode **Host PC IP to `127.0.0.1`**, then restart the TV. This
   manual setting enables the updater's local developer connection. It cannot
   be changed through the normal public TV application API.

Companion checks for updates after startup and every six hours while active.
It offers an update while browsing, postpones the dialog during playback and
other modal flows, and remembers **Later** for 24 hours. **Update now** opens
the updater with an install-and-return intent. The updater verifies, downloads,
signs and installs Companion, confirms the new installed version, then reopens
Companion. Opening the updater directly shows an **Update now** button and
does not automatically reopen Companion after an update. **Settings → App
updates** opens the updater directly.

Download/upload progress uses transferred bytes. Installation uses percentages
when Samsung reports them; signing and firmware without install percentages use
an activity indicator. Failed updates retain an actionable error
and can be retried. Installed versions are checked before and after installation;
an older published version cannot downgrade Companion.

## Compatibility and identities

| Component | Package | Application | Requirement |
| --- | --- | --- | --- |
| Companion | `IzumiTV001` | `IzumiTV001.IzumiTV` | Tizen 2.3+ |
| Updater | `IzumiUP001` | `IzumiUP001.Updater` | Tizen 3.0+ with Web service support |
| Update service | `IzumiUP001` | `IzumiUP001.Service` | Node Web service runtime |

Do not change these identities. Updating the same Companion package preserves
its pairing, playback progress and preferences. The service bundle is compiled
to ES5 and parsed as ES5 during its build; the development TV runs Node 4.4.3.
The UI remains compatible with Chromium 56. Firmware and certificate restrictions
can vary; Tizen 3.0+ is a minimum requirement, not a claim that every model has
passed physical testing.

The updater does not replace its own running package. To repair it or upgrade
the updater itself, set Host PC IP back to the desktop computer, restart the TV,
and run the desktop installer. Then restore `127.0.0.1` and restart again.

## Signing, transport and trust

- Windows desktop identities remain under
  `%APPDATA%/izumi-tv-installer/samsung-certificates`. Keep an offline backup.
  Known legacy installer data directories are checked for the same TV's identity
  on first use and preserved in the current directory.
  The installer does not replace a missing, corrupt, expired or incompatible
  author identity with a new author key. Certificate repair must preserve the
  original author identity.
- Public WGTs contain no device credentials, passwords, API tokens or private
  provisioning keys. Public release packages remain unsigned; each device signs
  its verified download with its original Samsung identity.
- Provisioning uses a TV-generated RSA-2048 key, RSA-OAEP key wrapping and
  AES-256-GCM encryption. A fresh challenge prevents replay. Existing identities
  can only be replaced by the same author key for the same TV.
- The temporary setup endpoint on port 18764 exposes only a public key and
  signed status receipts. Code verification is required before the first secret
  transfer. The endpoint closes after setup or after ten minutes. Credentials
  arrive through SDB as ciphertext; plaintext is written atomically with mode
  0600 inside `wgt-private` and is never placed in shared staging storage.
- The update API on port 18763 binds only to loopback and requires a random
  token read from the same package's private storage. It offers fixed check,
  update and launch actions; callers cannot supply commands, package URLs or WGTs.
- Downloads require HTTPS and certificate validation, with a current root store
  bundled for the old Node runtime. Trust is anchored in the designated GitHub
  repository and GitHub's HTTPS release-asset digests, not an independent release
  signing key. Account/repository access remains part of the release trust model.
- Downloads and archives have size limits; wrong identities, versions, unsafe
  archive paths, incomplete releases and hash mismatches fail before signing.
- Samsung upload packets wait for acknowledgement and the final file-acceptance
  response. The installer also verifies actual package identity and version;
  acknowledging an install command alone is not treated as success.

Do not use `tizen.package.install`: its platform-level installation privilege is
not available to an ordinary sideloaded web app. The updater uses the developer
connection on `127.0.0.1:26101` instead.

## Build and releases

```powershell
npm ci
npm ci --prefix updater
npm run check
npm run build:all
node scripts/package-companion.mjs
node scripts/verify-release.mjs
```

Outputs are `artifacts/izumi-companion.wgt` and `artifacts/izumi-updater.wgt`.
The updater includes its AGPL-3.0-or-later license and third-party notices;
Companion retains its existing license. Desktop installers are not part of the
TV release workflow while that source is awaiting review.

Set the same release version in root `config.xml`, `updater/config.xml` and
`updater/package.json` (including its lockfile). Run the **Build TV release**
GitHub workflow. It builds both WGTs and creates a **draft** release. Publishing
the complete stable
`vMAJOR.MINOR.PATCH` release makes it visible to the installer and update checks.
Both fixed WGT names and GitHub-generated `sha256:` digests must be present.
Do not overwrite assets in a published release; ship a new version instead.
The updater deliberately ignores draft and prerelease releases, so its real
GitHub download path can only be tested after both assets are published. Keep
the existing Companion on the test TV, deploy only the helper, then exercise
the version upgrade through the updater. Publishing remains a separate action.

For local maintainer deployment with an existing identity:

```powershell
node installer/src/setup-local.cjs --ip 192.0.2.10 `
  --updater artifacts/izumi-updater.wgt `
  --certificate-dir "$env:APPDATA\izumi-tv-installer\samsung-certificates"
```

The CLI waits for the code displayed on the TV before first provisioning.
The desktop UI always uses release downloads; the local CLI is for development.
This helper-only command preserves the older Companion for the update test.

## Hardware verification

Before releasing an updater change, verify on a physical TV:

- First-time code verification and the encrypted identity-transfer receipt.
- A newer-version update through the loopback connection, including package
  verification, progress, saved playback data and returning to Companion.
- Recovery from interrupted downloads, rejected signatures and installation errors.
- Repair through the desktop installer with the original signing identity.

Automated tests cover these boundaries but do not emulate Samsung's installer.
Keep device-specific results and addresses outside the public repository.

References: [GitHub release asset digests](https://docs.github.com/en/rest/releases/assets)
and [Samsung Web service application guide](https://github.com/Samsung/tizen-docs/blob/master/docs/application/web/guides/applications/service-app.md).
