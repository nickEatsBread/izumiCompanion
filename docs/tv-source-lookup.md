# TV-assisted cloud source resolution

When cloud playback cannot query Torrentio, Companion can request the source
metadata over the TV's home connection and return it to the private Worker.
Izumi can remain closed. TorBox credentials stay in the Worker, which checks
cached availability and resolves the selected torrent to a direct video URL.

The existing `/resolve` request advertises `tvSourceLookup: 1`. A capable Worker
can answer with `tvSourceLookup: { version: 1, ticket, requests }`. Each request
contains an opaque ID and a public Torrentio stream URL. The TV validates the
host, resource route, identifier, and allowed public configuration options before
making a GET without Worker authorization or account credentials.

Companion sends at most two source requests concurrently, bounds response sizes,
and returns only torrent metadata in `tvSourceResults: { ticket, results }` to the
same `/resolve` endpoint. The Worker verifies and consumes the short-lived signed
ticket before performing native debrid resolution. A play or profile change
prevents the TV from resuming the stale lookup. No second assisted round is made.

This works with `cloud-only` and `cloud-and-device`. Existing client fallback
preferences still apply if the assisted attempt fails. Older Workers ignore the
new capability field and retain their previous behavior. The first source adapter
is Torrentio; arbitrary credential-bearing add-on URLs are not copied to the TV.

Validation includes receiver routing, credential/URL rejection, disconnect handling,
Worker ticket tampering/expiry/replay checks, and live resolution through TorBox.
The live harness resolved Shrek and Skinwalker Ranch S01E01 in about three seconds
and confirmed both media URLs were available. Physical TV decoding and installation
remain separate checks. The development widget is packaged as
`artifacts/izumi-companion-tv-source-lookup.wgt`; it is not a published release.
