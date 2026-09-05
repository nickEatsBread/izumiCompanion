# Discover on TV

Discover is available beside My List in navigation. It presents title artwork, synopsis, metadata,
available trailers and the explanation supplied with each recommendation. Save, temporary skip,
Not for me, undo and refresh are reachable using a remote. Back returns to My List.

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
