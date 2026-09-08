# Worker updates from Companion settings

Settings → Connection shows **Update Worker** when the receiver has a saved Cloudflare transport,
including a transport configured for device-only playback. Unlinked TVs do not show or navigate to
the action. The receiver exposes only the public Worker endpoint to this screen.

Opening the screen checks the connected Worker's public status using a bounded GET without an
authorization header. Invalid versions, unexpected protocols, network failures and timeouts are
reported without claiming the Worker is current. Companion reports the installed version; the
latest full Izumi client determines whether a newer bundled Worker is available.

The update screen directs the owner to Settings → Device sync → Sync & devices → Update Worker in
the full client. A public QR guide covers other deployment methods. It contains no Worker address,
pairing credentials or account token. Cloudflare administration remains on the owner's phone or
computer, where a fresh token authorizes installation. No Worker protocol or installer change is
needed for this TV action.

Remote navigation reaches the action only when present, moves between Back and Check again, and
returns to Connection when dismissed. Requests completing after the screen closes cannot change
its state. Failed status checks leave the instructions available.

Verification on 2026-09-08: `npm run check` passed TypeScript checking, 315 Companion tests and
19 updater tests. `npm run build:all` passed. A browser preview at 1280 × 720 verified the screen
layout, QR rendering, remote Check again and Back, and absence of the action for an unlinked TV.
No physical-TV or live Worker deployment was performed.
