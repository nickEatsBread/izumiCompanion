# TV playback, search, and navigation fixes

## Playback

The remote scrubber accumulates a target while the button is held, then commits one asynchronous seek after release. The seek enters buffering immediately, suppresses the hold overlay, and has a 12-second deadline. Failure triggers the existing bounded playback recovery at the requested target. Completion, cancellation, and recovery invalidate stale callbacks. Native time/track queries and player mutations are deferred while a seek is pending, in accordance with the Samsung callback contract.

Only supported play/resume buffer parameters are configured, both to eight seconds. Adaptive streams request the highest allowed skip bitrate while retaining configured bitrate limits. This can avoid selecting a low-quality adaptive rendition after a seek; it cannot repair compression artifacts in a fixed-quality video or guarantee hardware decoder behavior.

Buffer percentages come from AVPlay events. A buffer-complete event confirms the configured minimum window, clipped to duration. The timeline displays that interval, resets on seek/rebuffer, and does not extrapolate it forward on every time callback. AVPlay does not expose a full media buffered-range API, so the display cannot claim the entire downloaded extent.

The spinner is 76 pixels, with a 44-pixel text margin. Margins are used because flexbox gap is unavailable on Chromium 56. Loading and buffering text and meters are enlarged.

## Search and voice

The TV debounces text input for 180 milliseconds, coalesces outgoing searches to avoid the service rate limit, aborts superseded requests, ignores late responses, and caches up to 24 results for two minutes. Cache keys include pairing, viewer, catalogue, query, and filters. Cloud-only searches report network failure directly instead of waiting for a desktop response simply because a Samsung channel exists.

The UI distinguishes the current query from its last settled result, keeping skeletons visible during debounce and network activity. Its response deadline covers the transport timeout. The deadline is armed before sending so synchronous cache hits can cancel it. Suggestions prefer matching titles, deduplicate them, and fall back to genres when appropriate.

Voice Interaction title context and Tizen foreground commands are registered together. Search phrases and recognized bare titles route through the current navigation callback, including closing overlapping in-app panels. Known playback/navigation commands are excluded from bare-title fallback. Duplicate reports from both services are coalesced. Older voice firmware receives bounded search and bare-title command pairs for catalogue titles; its public API does not provide unrestricted microphone dictation.

## Startup and home navigation

Update discovery starts after 500 milliseconds. Failed requests retry after the network has had time to settle, with foreground/online checks and a six-hour interval after success. Dismissal applies to the current launch only. The prompt waits for an eligible screen and does not interrupt playback.

Home focus is applied in the layout phase. Focused artwork/title DOM nodes are retained, their entrance animations are removed, and identity-based render state replaces redundant effect-driven resets. Destination-title warming remains separate from the smaller active-row artwork decode budget. Carousel row heights are computed once per row collection.

## Validation and limitations

Tests cover asynchronous seek serialization, pause during seek, missing-callback recovery, cancellation during recovery, actual buffering callbacks, superseded search requests, cache reuse, rate-limit retry, startup update retry, both voice APIs, and skeleton/suggestion state. The Chromium 56 harness additionally exercises remote navigation, title paint, held-key release, loading spacing, suggestion selection, and startup update installation intent. It uses simulated media/voice APIs and does not replace physical-TV playback, firmware recognition, or an end-to-end update test.

The 0.2.40 release run passed 215 client tests, 19 updater tests, both widget builds, and package identity/content verification. Chromium 56 measured 9.8 ms average and 13.9 ms maximum D-pad focus commit time on the development computer. These timings are browser regression measurements, not physical-TV benchmarks.

API references: [Samsung AVPlay](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html), [Voice Interaction](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/voiceinteraction-api.html), and [Tizen Voice Control](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/voicecontrol-api.html).
