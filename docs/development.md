# Development and releases

## Local preview

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/`. Use the preview bar, mouse or arrow keys, Enter and Backspace.
For a specific screen, use `?preview=1&screen=home`, `series`, `player` or `ready`.

## TV builds

```powershell
npm ci
npm ci --prefix updater --ignore-scripts
npm run check
npm run build:all
node scripts/package-companion.mjs
node scripts/verify-release.mjs
```

The build creates unsigned `artifacts/izumi-companion.wgt` and `artifacts/izumi-updater.wgt`.
The desktop installer signs them for the target TV. Keep package IDs and Samsung author keys
stable across updates. Physical-TV development commands are in [AGENTS.md](../AGENTS.md).

Run `npm run check:m56` on Windows to check the production UI in Chromium 56.
This browser check covers layout and remote controls; Samsung installation and playback still
need physical-TV verification. See [updater hardware verification](tv-updater.md).

## Desktop installer

```powershell
npm ci --prefix installer
npm run assets --prefix installer
npm test --prefix installer
npm run test:ui --prefix installer
npm start --prefix installer
```

Build using `npm run dist:win --prefix installer`, `dist:mac`, or `dist:linux` on the matching OS.
The installed release runtime is copied directly from `updater/runtime/`, including the shared
release configuration. The browser client imports that same configuration.

## Publish a release

1. Set matching versions in `config.xml`, `updater/config.xml`, `updater/package.json`,
   `updater/package-lock.json`, `installer/package.json` and `installer/package-lock.json`.
   Both lockfiles must also have matching root-package versions.
2. Commit the release, including the installer source, and create a matching `vX.Y.Z` tag.
3. Push the tag, or run **Build release** from GitHub Actions on the release commit.
4. The workflow validates versions, runs tests, builds both TV WGTs and the Windows,
   macOS and Linux installers, then creates a **draft release** with `SHA256SUMS`.
5. The workflow checks that GitHub finished every upload and that its SHA-256 digests match
   the built files. It also validates the metadata's final release URLs with the updater's real parser.
6. Review and publish the draft as a stable release. Mark the newest production version
   as **Latest** if GitHub does not select it automatically.
7. **Verify published updates** then downloads both WGTs from the unauthenticated latest-release
   feed and checks their hashes, versions and package identities. This runs on publication and
   can also be started manually from Actions.

The release repository must be public: `nickEatsBread/izumiCompanion`. Companion and the
desktop/TV updaters use its unauthenticated `/releases/latest` API. Drafts and prereleases are
excluded; incomplete, mismatched, oversized or unverified TV packages are rejected.
The [GitHub release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
provides the stable release metadata and [asset SHA-256 digests](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/).

Never upload TV-specific signing identities. Both public WGTs stay unsigned. The installer
and TV helper verify the download, then use the same saved Samsung identity to sign it.
An already-published release is not overwritten by the workflow; ship changes as a new version.
