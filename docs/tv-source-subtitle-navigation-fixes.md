# TV playback and navigation fixes

## Source selection and cancellation

The TV retains all twelve bounded Worker choices. The Worker resolves up to three distinct converted releases within its existing deadline, so a successful first conversion no longer removes the alternatives. Loading identifies the selected release. Back during preparation closes the native player, aborts outstanding TV requests and subtitle downloads, invalidates delayed callbacks, and opens the source picker at the current position. Before source discovery finishes, Back cancels discovery and returns to browsing.

Explicit preview releases and declared incompatible encodes are filtered before ranking. A feature-length title with a known runtime also rejects a prepared source whose reported duration is under twenty minutes and less than 45% of the expected runtime. Unknown durations are not treated as previews. These guards cannot repair damaged video bytes or establish the cause of an individual decoder artifact without a physical-TV reproduction.

## Subtitles

Cloud playback supports stream sidecars, installed subtitle add-ons, and the portable built-in subtitle service configured by the desktop client. Search does not request quota-bearing downloads. Selecting a service track requests its file through an expiring, pairing-scoped Worker ticket. The private service configuration and account session stay in the Worker; public settings redact credentials. Refresh TV playback settings from the updated desktop client to upload the new subtitle configuration. Saved track-language preferences reach every playback alternative, allowing the TV to select matching embedded subtitles while preserving an off preference.

External downloads have a deadline, byte limit and actual request cancellation. Format detection reads the content so extensionless Worker links support timed text and dialogue scripts. The TV retains descriptive track names, decodes text entities, applies basic script font/size/weight/colour styles, and packages the UI font's available language subsets locally. The desktop's default font name maps to the bundled TV family. The native player is put in silent-caption mode after opening each source so the custom overlay receives text without competing with a native overlay.

Native player text callbacks do not expose embedded font attachments. Unavailable font families use the bundled/system fallback; this implementation does not reproduce arbitrary vector typesetting or embedded font attachments. Bitmap captions and device-specific codec behaviour still require hardware verification.

## Navigation and customization

Settings → Appearance → Edit screens and rows provides remote controls for visibility, ordering and reset. Preferences are stored per TV profile and catalogue; the final remaining item cannot be hidden. New rows remain available after catalogue refreshes.

Focused-card movement uses a short cancellable transform/opacity animation on the retained card. Missing artwork has an independent pulse placeholder. The cache remains bounded and the focus outline stays stationary. This separates immediate input feedback from artwork arrival. Reduced-motion settings disable both motion and pulsing.

The fixed home surface and its ancestors have their native scroll offsets reset during layout and after focus. Navigation restoration no longer reapplies browser-generated scroll offsets to fixed cinematic surfaces. This addresses clipping after returning from details before another directional input.

## Research and verification

The research covered published TV rendering and graphics-memory engineering, and the distinction between immediate focus feedback and asynchronous artwork arrival. A particular service's exact current placeholder timing is not publicly specified; the implementation is based on these documented principles and direct browser testing.

Public API references: [compositor-friendly animation](https://web.dev/articles/animations-guide), [native player lifecycle](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html), [subtitle callbacks](https://developer.samsung.com/smarttv/develop/guides/multimedia/subtitles.html).

Regression coverage includes source normalization, cancellation during prepare/download/discovery, late callbacks, descriptive names, dialogue styling, layout persistence/isolation, and remote layout editing. The Chromium 56 harness checks repeated card animations, a single artwork layer, unclipped detail-page return, editor persistence and normal navigation. Browser simulation does not constitute an installation or playback test on a physical TV.

Build both widgets and package the companion normally. These changes require the updated TV widget, the updated Worker, and saving TV playback settings from the updated desktop client. No production Worker or physical TV was changed by the implementation checks.
