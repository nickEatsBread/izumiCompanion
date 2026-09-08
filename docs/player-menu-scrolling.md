# Player menu scrolling

Remote Up/Down changed the highlighted option without scrolling the player menu. In the
Chromium 56 regression, the seventh source was clipped while the list remained at scroll
position zero. The list's previous maximum height also failed to account for the menu's
padding and heading, allowing its lower rows to extend outside the panel.

The player now measures the highlighted row after layout and adjusts only the option list's
scroll position enough to reveal it. Updates are immediate, so held remote keys and direction
changes cannot leave queued scrolling behind. This also handles opening at a saved source
and replacing menu choices. The panel stays within the viewport; its heading retains its
height and the scrollable list fills the remaining space. Source, audio and subtitle menus
share this behavior.

After building, run `node scripts/check-chromium-m56.mjs --player-menus-only` for the focused
browser regression. It dispatches actual remote key events through the app with long preview
lists, checking each row in both directions, list boundaries, rapid direction changes, linked
sources, the final action, reopening and restoring a source after cancelling preparation.
Source lists run at 720p, 1080p and 4K; audio and subtitle lists run at 1080p. The full Chromium
56 harness includes the same checks. Browser verification does not replace physical-TV testing.

Verification passed: `npm run check` (331 client tests and 19 updater tests), `npm run build:all`,
the focused Chromium 56 regression, and `scripts/package-tizen.ps1`. The widget was packaged
locally; this change was not deployed to a physical TV.
