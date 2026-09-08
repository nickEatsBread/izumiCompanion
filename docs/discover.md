# Discover on TV

Discover is available beside My List in navigation. It presents title artwork, synopsis, metadata,
available trailers and the explanation supplied with each recommendation. Title logos use the
existing decoded-image cache and retain a readable title while artwork is loading or unavailable.
Movie/series type, year, runtime, rating and genres use dot-separated presentation. Poster-only
titles keep the complete poster instead of stretching it across the feature.

Five labeled tiles expose nearby picks. D-pad movement previews titles without recording feedback;
OK moves to the title actions. Left/right continues across groups. Paging buttons offer the same
navigation with a pointer. The two action rows, paging controls and tile strip have explicit remote
focus transitions that skip disabled controls. No automatic carousel rotation or trailer startup
occurs. Save, temporary skip, Not for me, undo and refresh retain their existing behavior.
Back returns to My List, or cancels/closes a trailer before leaving discovery. Repeated trailer
requests are guarded, stale responses release their source, and the browsing layers are hidden
while the existing fullscreen player is active.

The layout uses the existing dark TV palette and large, high-contrast focus states, with all content
fitting the fixed 1920x1080 TV viewport. Recommendations remain unchanged until a viewer acts.
This follows [NN/g carousel guidance](https://www.nngroup.com/articles/designing-effective-carousels/)
on recognizable choices and explicit navigation, and the
[W3C carousel pattern](https://www.w3.org/WAI/ARIA/apg/patterns/carousel/) on labeled controls and
user-controlled changes. The desktop visual direction is adapted to remote control and Tizen's
legacy rendering engine, without copying implementation from the main client.

## An MIT client consuming AGPL service results

The recommendation engine remains in the AGPL main Izumi client. No engine source is copied or
bundled into this MIT repository. The encrypted companion protocol carries ordered media and
`recommendation: { reason, evidence, exploration }` results. TV preserves that order while
filtering local choices, watched titles, duplicates and parental restrictions.

Feedback is stored per profile, capped at 500 records, and retried after connection returns.
Skips expire after seven days. Newer undo decisions override older snapshots. The cloud journal
is separately encrypted, and only compact title metadata is included in feedback.

Personalized re-ranking updates when the main client syncs. Without it, TV can browse the cached
ranked deck and additional cloud catalog choices; those extra choices are not described as
personalized. Device-only providers need the main client to refresh their metadata.

Cloud feedback requires private Worker 1.8.0 and migration 0005. An older Worker leaves choices
pending without breaking local browsing. Receiving a linked snapshot with the exact decision
also acknowledges a local-network sync.

## Verification

Run `npm run check` and `npm run check:m56`. The compatibility suite checks Discover geometry,
explanations, save/undo and remote navigation at Tizen's fixed 1920x1080 CSS viewport.
Package with the existing Tizen script and verify installation and playback on a physical TV.
