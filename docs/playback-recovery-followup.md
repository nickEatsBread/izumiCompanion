# Playback recovery and source selection

Background catalogue snapshots previously reset navigation even while the native player continued running. Snapshots now update data without replacing an established screen; explicit catalogue navigation and initial startup retain their intended transitions.

Audio and seeking share a serialized native-operation queue. A newer track choice supersedes older retries. Confirmed audio survives native recovery and seeking, and a manual language choice is carried to another source for the same title. Missing language metadata can be revisited when track information arrives later. A matching codec cannot override contradictory language metadata.

Samsung documents AUDIO selection in PLAYING; PAUSED selection is supported only for TEXT. The controller temporarily resumes paused video for audio selection and restores the user's pause state. Native restore now uses the documented URL, position, preparation flag, and asynchronous callback arguments. See [AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html).

The source menu can request further cloud choices while excluding already offered IDs. A partial lookup preserves playable choices when another configured source needs a signed continuation. Cancellation settles outstanding requests and discards late responses. Source refresh never initiates linked-device playback.

Known feature runtime is checked both after prepare and when native playback first supplies a duration. A confirmed short preview is rejected without reopening the same source. Unknown durations and genuine short-form titles are not rejected by a blanket minimum duration.

Worker filtering rejects explicitly declared unsupported bit depths and chroma formats. It cannot diagnose visual corruption in an otherwise supported file without observing native playback. Samsung's [video decoder specifications](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2017-tv-video-specifications.html) also identify bitrate, frame-rate, malformed-container, and network constraints. Hardware playback remains necessary to confirm visual stability and audible language selection.

Verification covers paused audio selection, rapid competing selections, source cancellation, recovery and seeking, late duration metadata, source refresh, and background navigation. The local build does not imply installation on a physical TV.
