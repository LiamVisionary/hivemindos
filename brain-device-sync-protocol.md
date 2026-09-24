# Brain device sync protocol

Developer reference for the desktop endpoint used by HivemindOS Mobile. This is file replication, not memory extraction: Markdown notes, skill folders, and binary attachments retain their bytes. The current server implementation is `src/lib/services/obsidian/mobile-brain-sync.ts`.

All requests use `POST /api/brain/sync` and the existing dashboard session or paired-device authentication. Runtime-agent principals are rejected. The desktop resolves its currently selected workspace vault; requests cannot supply an absolute vault root. Clients must retain the original desktop connection and must not fail over mutations to another machine.

## Manifest

```json
{"action":"manifest","limit":200}
```

Returns `{ok:true,protocol:1,vaultId,entries,nextCursor?,complete,truncated,reasons,limits}`. Each entry is `{path,revision,size,modifiedAt,deleted?}`. Paths are vault-relative, revisions are lowercase SHA256 hex, and times are milliseconds since the Unix epoch. A deleted entry retains the previous content revision. Its bytes are absent; recreation uses `expectedRevision:null`.

Pass `nextCursor` as `cursor` to resume. Work is bounded per page, so a large vault continues on subsequent pages. Emitted pages are immutable and replayable. Scan progress and its pages survive server restarts. Cursors expire after ten minutes without progress; the server retains up to eight recent scans. An expired cursor returns 409 with `code:"snapshot-expired"`; discard that partial traversal and restart.

Only a terminal page with `complete:true` proves a full, stable traversal. Directory changes during traversal invalidate absence inference. A terminal `complete:false,truncated:true` response still contains usable observations and explicit tombstones, but the client must not infer deletion or absence from paths it did not receive. `reasons` can contain `files-changed`, `file-too-large`, `directory-limit`, `unreadable-file`, or `unreadable-folder`. A transiently changed file is checked again on the next traversal.

The server retains bounded history for explicit external-deletion detection. Older history can be omitted; clients retain their own per-desktop baseline and use a completed manifest to determine absence. Files named only by earlier pages are not assumed deleted when a cursor expires.

## Read

```json
{"action":"read","vaultId":"<returned-id>","files":[{"path":"Notes/Example.md","revision":"<sha256>"}]}
```

Returns `{ok:true,vaultId,results}`. Results include `path` and `status`: `ok`, `not-found`, `conflict`, `too-large`, or `invalid`. An `ok` result includes `revision`, `size`, `modifiedAt`, and `contentBase64`. A revision mismatch returns `currentRevision`; refresh before using newer bytes as a baseline. Files have no extension allowlist.

## Apply

```json
{"action":"apply","vaultId":"<returned-id>","changes":[{"path":"Notes/Example.md","expectedRevision":null,"contentBase64":"SGVsbG8K"}]}
```

For deletion, omit `contentBase64` and set `deleted:true`. Returns `{ok:true,vaultId,results}` with `status:applied|unchanged|conflict|invalid`, and optional `revision`, `deleted`, `currentRevision`, or `conflictPath`. Malformed batches are rejected before any writes. Valid batches are processed one file at a time; an individual failure does not imply that earlier results were rolled back.

`expectedRevision:null` creates only when the path is absent, including after a tombstone. Updating or deleting existing bytes requires their current revision. Identical desired bytes are an idempotent success even if an acknowledgment was lost. A conflicting update leaves the current file intact and retains incoming bytes in a deterministic `Sync Conflicts/` file. A conflicting deletion preserves the current file. The client must likewise preserve unsynced local bytes when accepting a desktop change.

Updates and deletes first move the old file into `.trash/HivemindOS Sync/`. A durable preparation record permits recovery after termination. New content is flushed into a temporary file and installed with exclusive creation, so a competing editor's replacement is never overwritten. The previous bytes remain recoverable. Recovery restores an archived file only when its original path is still absent. Sync operations share the existing cross-process lock mechanism; a process that died with a lock is eligible for recovery after its stale-lock interval.

Committed changes also leave durable search invalidation in private `brain-file-indexes` state. The canonical memory and full-vault search readers refresh their generated indexes before answering; typed-memory reads rebuild under the existing memory write lock. Full-vault query caches and shared skill caches incorporate the durable version, so another process cannot keep serving an older cached result after a file change. Failed invalidation delivery remains in the sync journal and retries before the next operation. This coalesces a run of uploads into one refresh at read time instead of rebuilding the full vault after every file.

## Bounds and ownership

- 8 MiB per file, 12 MiB of decoded content per batch, 16 batch items.
- Up to 500 manifest entries per page, 256 MiB of hashing per page, and 60,000 inspected directory entries per page. An individual directory exceeding the inspection bound makes that traversal partial.
- Symlink files and directories are excluded; traversal, hidden paths, components longer than 240 characters, and trailing dots/spaces are rejected. Hidden configuration, build outputs, generated Brain indexes and replay generations, and runtime mirrors do not replicate. Ordinary Markdown under `Operations/Brain Services/` remains included.
- The local app keeps sync identities, scan pages, hashes, preparation records, and bounded receipts outside the vault under its private `brain-sync` state. Neither this metadata nor recovery trash is replicated by this endpoint.
- `Sync Conflicts/` and recovery trash are created only when needed. They are not additions to the default vault scaffold. No new setup daemon or external sync service is installed.

Hermetic validation: `pnpm test:brain-device-sync`. Fixtures use temporary vaults and test the actual route handler, conflict preservation, binary files, pagination, external mutations, symlink rejection, process-termination recovery, and actual desktop memory/search/skill readers after synced creates, edits, and deletions. Tests do not read or mutate the user's configured vault.
