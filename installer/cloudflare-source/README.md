# Native Cloudflare deployment source

This release snapshot provides the shared Cloudflare deployment operations for
the desktop and mobile installers. `tv-link-source.json` records its source
revision. It includes only native deployment, proof calculation, input validation,
and the Worker payload/migrations deployed to a user's Cloudflare account.

Build with `npm run cloudflare --prefix installer`. The generated CommonJS bundle
is packaged in the installer; source and dependency locks remain in this repository.
The native deployment source is distributed under the installer's AGPL-3.0-or-later
license. The bundled Worker retains its own license notices.

When changing deployment behavior, update the TV Link implementation and this
snapshot together, including the recorded revision and tests. Release builds do
not require access to the TV Link repository or any account credentials.
