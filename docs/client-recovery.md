# Link a phone or desktop from Companion

Open **Settings → Connection → Link phone or desktop**. Use a phone camera to scan
the QR code, or enter the displayed Worker address and code in the full client's
**Settings → Device sync → TV → Restore from TV** page. Install the full client
first if it was removed.

Leave the TV screen open until linking completes. The code expires after ten
minutes and works once; Back cancels an unused code. The client explicitly accepts
the restore and receives its own credentials without unpairing the TV. Household
linking requires the first unrestricted profile and its configured PIN.

This needs Worker 1.11.0 and updated clients. TVs without a private Worker show the
existing independent-setup instructions. Older independent TVs restore the saved
TV setup and available TV watch progress. When reverse linking is opened, the TV
generates a separate 32-byte recovery secret using cryptographic randomness if it
does not already have one. It saves the secret locally before allowing linking,
and reuses it across restarts for the same Worker endpoint, pairing ID and TV token.
If secure randomness or saving the secret fails, linking is unavailable; the TV
never exports an unsaved secret or substitutes insecure randomness.

An already configured full client must scan this TV's reverse-link QR once (or
use its address and one-time code) to receive the recovery secret and seed the
encrypted backup for future full recovery. Normal pairing does not automatically
seed that backup. Until a configured client completes this step, restoration is
limited to the saved TV setup and available watch progress, even if the TV has
just generated its recovery secret.

The QR carries a short-lived secret, not the TV's persistent credentials. The TV
encrypts the connection payload before storing it in the private Worker. A
separate recovery secret protects the sync key and is never used as a bearer token.
It is shared with the full client only inside the encrypted reverse-link payload;
the visible QR and manual code never contain the recovery secret itself. Plaintext
Smart View pairing and transport messages cannot inject or replace it. Such
messages retain the existing local secret only for the same endpoint, pairing ID
and TV token; a different route starts without that secret. Authenticated encrypted
standalone TV setup may retain a recovery secret supplied within its protected
payload, while a repeat of the same route preserves the TV's existing local key.
Leaving, refreshing, or unmounting the screen cancels pending grants, including
late request completion.

The matching Worker source, migration, desktop/mobile restoration and protocol
notes live in the sibling full-client repository's `docs/tv-client-recovery.md`.
The installer snapshot must include migration `0008_companion_client_links` and
the `companion-client-link-v1` capability before release. Automated checks and
browser preview do not establish physical-TV deployment or a live account restore.
