# izumi Installer and Updater

The desktop installer source was migrated from the legacy `izumi-companion/installer`
tooling. These installer and updater components are licensed under AGPL-3.0-or-later.
The separately packaged Companion application retains its existing license.

- tizen.js by Reis Can, GPL-3.0, pinned to commit
  `45b00106149d0c8eff74ead4a979c909dd80efd6`:
  https://github.com/reisxd/tizen.js. Its certificate and XML signature logic derives
  from Samsung/webIDE-common-tizentv, licensed under Apache-2.0.
- JSZip by Stuart Knightley and contributors, MIT or GPL-3.0:
  https://github.com/Stuk/jszip.
- node-forge by Digital Bazaar and contributors, BSD-3-Clause or GPL-2.0:
  https://github.com/digitalbazaar/forge.
- @xmldom/xmldom, MIT: https://github.com/xmldom/xmldom.
- core-js by Denis Pushkarev and contributors, MIT:
  https://github.com/zloirock/core-js.
- Nunito Sans by Vernon Adams, Jacques Le Bailly and contributors, SIL OFL-1.1:
  https://github.com/googlefonts/nunito.
- Electron, electron-builder, node-fetch and form-data retain their respective
  licenses included with their distributed packages.

Corresponding source, build scripts and dependency locks for release artifacts:
https://github.com/nickEatsBread/izumiCompanion.
