# Connected accounts and collections

Companion supports the private Worker's `companion-accounts-v1` and `companion-collections-v1` capabilities, available in Worker 1.10.0. Configure Nuvio or Stremio in the full Izumi client's **Settings → Device sync → TV → TV accounts**. On the TV, open the Izumi logo's catalogue picker for account libraries and collection folders. Folder artwork, nested Back navigation, empty/error states and additional pages are supported.

Account connections are scoped to the pairing owner and active Izumi profile. Nuvio uses its own device-code session and an explicitly selected unlocked profile. Sending TV playback is opt-in; Companion checks that preference before sending readable title/progress data to the private Worker. Existing encrypted progress continues independently. Older Workers simply omit account options.

Collections can use installed Stremio add-ons and TMDB. Nuvio/Omni JavaScript providers and Trakt folders require the full client. TV account library editing and Stremio watched-bitfield editing are not included. Nuvio completion uses its watch-progress API; Stremio receives resume updates while preserving its existing watched state. Upstream failures are shown without replacing the last usable catalogue.

The installer embeds the matching Worker and account-table migration. Its deployment source is mirrored from the revision in `installer/tv-link-source.json`; migration regression tests live with that snapshot and in the canonical TV Link repository. Desktop and mobile installers share the resulting deployment bundle.

See the full Izumi repository's `docs/companion-accounts.md` for setup, privacy, limits and API references. Browser fixtures and automated tests cover these flows; a physical-TV and live-account check is still needed before claiming an end-to-end deployment.
