# Document and compliance workers

## Implemented execution

Migration `BindDocumentWorkers1793664000006` adds a per-claim execution ID and document-specific
PostgreSQL commands. The worker runtime consumes `documents` (concurrency 4) and `compliance`
(concurrency 8), alongside dispatch and safety queues. All queues share durable-intent claiming,
retry, and terminal-state handling.

- Queue name, job name, deterministic ID, intent ID, and due time are checked before processing.
  PostgreSQL supplies the resource, version, tenant, correlation, and payload. Unbound queue messages
  cannot fail or release an intent. Completion/retry/failure updates require the current execution ID.
- Document reads require a running, due intent for that exact object and matching tenant (including
  personal objects with no tenant). Restrictive worker RLS prevents broader tenant claims from
  expanding document access. Direct worker document/link UPDATE grants are revoked.
- Named scan/expiry commands lock the intent through transaction completion, then perform versioned
  changes. A replacement execution cannot race their commit. Scanning/provider I/O occurs outside
  the mutation transaction. Events and audits commit with the changes; repeat/stale jobs add no facts.
- Expiry uses the day after the inclusive `expiresOn` date in UTC. Equipment changes also schedule a
  future readiness check when an expiry date exists. Readiness recomputes current evidence rather
  than applying an old snapshot. Only changed readiness produces an event and audit.
- Document readiness jobs resolve their ambulance through the persisted document link. Maintenance
  and equipment jobs bind directly to an ambulance and tenant. Other document subjects have no
  materialized ambulance projection to update. Required-evidence catalogs and broader readiness
  policies remain Gate 4 work.

Outstanding legacy document/compliance job IDs containing colons are converted to BullMQ-compatible
IDs by migration 0006; completed/failed/cancelled evidence is retained. Stop API writers, the relay,
and workers during this migration/release transition. Apply the forward migration before starting
the new worker image; it requires `execution_id` and the new commands.

## S3 adapter

Configure `RESQ_DOCUMENT_BUCKET`, `RESQ_DOCUMENT_ACCESS_KEY_ID`, and
`RESQ_DOCUMENT_SECRET_ACCESS_KEY` together. `RESQ_DOCUMENT_REGION` defaults to `us-east-1`.
The endpoint is `RESQ_OBJECT_STORAGE_ENDPOINT`; `RESQ_DOCUMENT_SESSION_TOKEN` supports temporary
credentials supplied by the deployment. Credential renewal/restart is an operational responsibility.
The adapter uses explicit credentials, so upload-grant signing does not fetch credentials while a
database transaction is open.

Uploads are single PUTs capped at 15 MiB. Ten-minute grants sign size, MIME, SHA-256 checksum,
`If-None-Match: *`, and server-side encryption headers. Clients must send all `requiredHeaders`.
Finalization reads the S3 checksum, size, and MIME. The scanner separately hashes the actual bytes
and checks the exact declared length. Five-minute downloads force attachment/octet-stream delivery.
The runtime does not create buckets, policies, keys, public ACLs, or object-deletion permissions.

`RESQ_DOCUMENT_KMS_KEY_ID` selects SSE-KMS and is required when production document storage is
configured. Development without it requests SSE-S3/AES256; the selected S3-compatible deployment
must support the requested encryption, conditional writes, and checksum API. Enforce immutability
and private access with bucket policies: nonconditional overwrite, deletion/recreation, and alternate
writers must not invalidate the key-based object identity after scanning. Provider policy acceptance
has not been performed locally.

## ClamAV adapter

Set `RESQ_DOCUMENT_CLAMD_SOCKET` to an absolute Unix socket shared with a managed `clamd` process.
This adapter uses `zINSTREAM` framing, bounded chunks/backpressure, a 4 KiB reply limit, and a total
deadline (`RESQ_DOCUMENT_TIMEOUT_MS`, default 30 seconds). It accepts only a complete, single
`stream: OK` reply after sending the full stream; infections, extra/truncated records, daemon errors,
and timeouts never authorize READY. Signature names and raw daemon responses are not persisted.
Content MIME is detected with `file-type` and must match the declared allowed MIME.

Bytes are held in a bounded memory buffer, cleared after processing, and are not written to local
files. The daemon needs current signatures, INSTREAM support, `StreamMaxLength` at least 15 MiB,
and reviewed policies for encrypted documents, embedded objects, and engine/recursion limits.
Daemon deployment, signature freshness monitoring, malware corpus acceptance, and KMS/key rotation
are still external acceptance work. No scanner is configured by default; attempts then fail retryably.

## Evidence

- Unit tests exercise queue identity binding, execution fencing, stale scans, MIME mismatch,
  repeated expiry, S3 signing headers/HTTP reads, integrity failures, Unix socket framing,
  malicious/truncated replies, buffer clearing, and daemon timeout.
- Six SQL-only cases pass with temporary serialized PGlite tooling. This is debugging evidence.
- Nine added supported-PostgreSQL cases cover scoped reads/mutations, tenant mismatch, stale and
  terminal claims, repeat expiry/readiness, concurrent processing, atomic audit/outbox rollback,
  and a separate-session execution-lock test. Their current CI result must be checked on the exact
  revision; local Docker remains unavailable.
- The event catalog now includes five document events and readiness changes (36 contracts total).

No live object store or ClamAV acceptance, production provider deployment, or migration/cutover has
been performed. Gate 4 and the remaining rollout gates stay HOLD.
