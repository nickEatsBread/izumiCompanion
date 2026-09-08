# Worker updates from Companion settings

Settings → Connection → Update Worker reads the paired Worker's authenticated update status.
**Update now** requests an immediate check using the TV's existing pairing; no deployment token,
repository address, update URL, or database identifier is accepted from the TV.

Worker 1.13 obtains deployment access and its six-hour schedule during a normal authorized Worker
install/update from Izumi. It then checks stable releases from the main Izumi repository even when
all devices are off. There is no separate setup button, QR guide, repository connection, or build
hook requirement. Temporary preview-account credentials cannot authorize future deployments;
the next normal authorized update provides durable access for an older or claimed preview Worker.

The TV distinguishes requested, installing, delayed, failed, and confirmed installed versions.
Opening the screen only reads status. Update now checks sooner; pending updates are polled, and
Back cancels the screen's HTTP request without canceling the Worker's deployment. Only the Worker
holds its deployment access, stored as an encrypted Cloudflare secret by the installer.

Release packages keep the existing Worker address, D1 database, device pairing, and secrets.
The Worker verifies a stable package checksum and applies pending migrations before replacing
its code. Failed or unconfirmed deployments are not reported as installed. Automatic retries use
backoff to prevent repeated device requests from starting duplicate deployments.

Validation covers authenticated requests, revoked pairings, concurrent updates, checksum rejection,
migration failure, credential redaction, installer provisioning, TypeScript, and widget builds.
Live deployment into a user account and physical-TV installation require separate verification.
