# Account sync and the HiveDrop inbox (builder s4a)

This note sits next to the export, not inside it: the desktop repo already has its own `DESIGN.md` (the design
system), so writing this one at the export's root would have replaced that file when the export lands.

Two shared protocols in the canonical hive core, sealed end to end, for the account relay
(`workers/brain-relay`) to carry:

- `src/shared/hive/core/account-sync.ts`: one pool of chats and small preferences across a person's own
  devices.
- `src/shared/hive/core/hivedrop-inbox.ts`: files sent between a person's own devices, for the two that cannot
  run a receiver (a phone, a browser).

There is no Worker or app code yet. Both files hold the protocol, its validators, the relay's rules (as pure
functions the Worker calls), and the clients the apps call. Tests: `src/shared/hive/tests/account-sync.test.ts`
(20) and `hivedrop-inbox.test.ts` (10).

## 1. Who holds the account brain key today

I traced each of these in the code at the export's base commit. Nothing here was run on a device.

| Device | Where the key lives | How it gets it | Evidence |
|---|---|---|---|
| Desktop | `HIVEMINDOS_BRAIN_KEY` in the shared credential store (PassBook), which replicates between desktops | Makes it on its first account sync if the account has no key check yet (the first writer wins). Otherwise it uses the copy it already holds, or asks another desktop with a key request. | `brain-device-storage.ts` `ensureBrainKey`, `awaitKeyFromAnotherDevice`; `maintainBrainDeviceStorage` runs on every account sync in **both** storage modes |
| Phone | Keychain via `expo-secure-store`, one entry per brain account id, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (never backed up) | Never makes one. Sends a key request (P-256 one-time key, six-digit code), and a desktop approves it. The phone drops its key when the account's key check stops opening (the key was replaced). | mobile `store/brainStorage.ts`, `store/brainStorageCore.ts` `keyFor`, `requestKey`, `checkKeyRequest` |
| Website | IndexedDB `hivemindos-brain-key`, one entry per brain account id; a page-only copy when storage is refused | Never makes one. Same key request, approved on a desktop. | website `src/lib/chat/brain-key-store.ts`, `brain-key-request.ts` |

What follows from this:

- The account id used everywhere is the **brain account id**: 64 lowercase hex characters. It is the same id the
  relay keys its rooms on (`index.ts` `accountFor`) and the one the brain cache binds into its additional data.
- **An account where no computer has ever signed in has no brain key.** Neither feature can work for it. The
  readiness model reports this as `needs-computer`. See open question 1.
- The key can be replaced, and a phone then forgets its copy. Records sealed under the old key stay unreadable
  (`old-key`) until their owner publishes them again (see §6).

## 2. Threat model

**What the relay sees** (the Worker, Cloudflare, and anyone who reads its storage or logs):

- The account (its room), and when and how often each device reads and writes, along with IP addresses.
- **Account sync:** the kind of each record (`chat` or `prefs`). Chat record ids, which are opaque: 16 bytes
  derived from the device id and the app's chat id under a key derived from the brain key. Preference document
  names (`p_voice`, `p_layouts`, `p_scout`). Each version's time, which is the writer's clock. Live, deleted or
  aged out. Sealed sizes. The key id.
- **Drops:** a random drop id, the file's exact size, when it was made and when it expires, how many chunks have
  arrived, and when each chunk is uploaded and downloaded.

**What the relay never sees:** chat titles, messages, previews, agent and model labels, device names and ids,
the app's own chat ids, attachment names, preference values, file names, file types, file contents, the file's
hash, or which device a file is for.

**Integrity.** Every envelope is AES-256-GCM. Its additional data binds the envelope to:

- for a sync record: its account, kind, record id, version time, live or deleted state, key id, and part (head
  or body);
- for a drop: its account and drop id. The manifest also binds the size, the creation time and the expiry, and
  each chunk binds its index and the chunk count.

The relay therefore **cannot**:

- change any byte;
- swap heads or bodies between records;
- move a record to another account;
- re-date a version;
- flip a delete;
- swap, reorder or move chunks;
- cut a file short or stretch its expiry without the open failing.

The tests check each of these and assert the exact reason each one is refused.

**Someone holding a stolen credit token**, or the relay itself:

- **Can** list and download sealed records and chunks, and delete records and drops.
- **Can** overwrite a record with junk dated up to 10 minutes ahead of the relay's clock. That record wins until
  its owner writes again, and devices show it as unreadable.
- **Can** fill an account's quotas (they are capped), and age out chats by publishing junk chats.
- **Can** hold back writes, or show a device that has never listed before an older version.
- **Cannot** read anything, forge a record or drop that opens, or make a device show a fake chat or file.
- **Cannot** take a device that already saw a newer version back to an older one: `applyAccountSyncPage` never
  goes backwards.

Availability against the relay is not protected, and cannot be without a second store.

**A lost device that holds the brain key** can read everything: the brain cache, and now chats, preferences and
waiting files. That is the same exposure the brain cache already has. **No flow exists to replace the brain key**
(open question 2).

**Network:** HTTPS. Even without it, only sealed bytes travel.

**Other accounts:** rooms are per account, and every key and every piece of additional data names the account.
A record copied into another room fails with `old-key` or `bad-seal`.

**Approved but untrusted relay behaviour, carried over from device access:** none. Neither protocol needs the
desktop to be online, and the relay adds no authority of its own.

## 3. Key derivations

Every key comes from HKDF-SHA-256 with a 32-byte zero salt, the same construction the brain core's key grant and
the device-RPC key use. The brain key is 32 uniformly random bytes, so a salt adds nothing; the info string gives
each use its own key.

| Key | IKM | Info | Length | Use |
|---|---|---|---|---|
| Sync seal key | brain key | `hive-account-sync/v1\nseal\n<accountId>` | 32 | AES-256-GCM of every head and body |
| Sync id key | brain key | `hive-account-sync/v1\nids\n<accountId>` | 32 | IKM for chat record ids |
| Chat record id | sync id key | `hive-account-sync/v1\nchat\n<deviceId>\n<chatId>` | 16 | `c_` + base64url |
| Key id | brain key | `hive-account-key-id/v1\n<accountId>` | 8 | In the open on every record and drop, and the same for both features. It tells records sealed under another key apart from tampered ones. |
| Drop wrap key | brain key | `hive-drop/v1\nwrap\n<accountId>` | 32 | Wraps each file key |
| File key | random (32 bytes, per drop) | — | 32 | The manifest and every chunk |

Additional data:

- sync part: `hive-account-sync/v1\n<account>\n<kind>\n<id>\n<updatedAt>\n<live|deleted>\n<keyId>\n<head|body>`
- wrapped file key: `hive-drop/v1\nkey\n<account>\n<dropId>\n<keyId>`
- manifest: `hive-drop/v1\nmanifest\n<account>\n<dropId>\n<size>\n<createdAt>\n<expiresAt>`
- chunk: `hive-drop/v1\nchunk\n<account>\n<dropId>\n<index>\n<count>`

**Nonces** are 96 random bits per seal. Volume stays far below the random-nonce limit (2^32 seals per key): 400
chats times thousands of versions under the sync key, and at most 52 seals per file key.

**Why not seal with the brain key directly**, as the brain cache does: separate keys mean a bug or a nonce slip in
one feature cannot touch another feature's data. They also leave the brain cache's format alone.

## 4. Limits, and why

| Limit | Value | Why |
|---|---|---|
| Chat head (sealed) | 4 KiB | Every list carries every head. The largest possible head (every field at its cap, all 4-byte characters) is about 3.2 KiB; a test seals it. |
| Chat body (sealed) | 192 KiB | Exactly 256 KiB as base64url: about 190,000 characters of text, more than nearly any chat. A longer chat keeps its newest messages, and `trimmed` says how many were left out. One message is capped at 32,000 characters. |
| Preference document (sealed) | 16 KiB | Up to 200 entries, each with its own time. |
| Delete (sealed) | 1 KiB | It holds only who deleted it. |
| Live chats per account | 400 | "A few hundred". Past it, the least recently updated chat older than the new one ages out (`gone`). Preferences never age out. |
| Live sealed bytes per account | 48 MiB | 400 chats at 120 KiB on average. Typical chats are 5 to 30 KiB, so the real total is a few MB. Worst-case storage cost is about $0.01 a month per account. |
| Rows (live, deleted, gone) | 2000 | Bounds a list. Past it, the oldest deleted or gone rows are dropped first. |
| Deletes and gone rows kept | 90 days | A device away longer than that can bring back a chat deleted elsewhere (see §6). |
| Version time ahead of the relay | 10 minutes | Otherwise a fast clock wins every merge. The relay answers `stale`. |
| List page / get | 100 rows / 8 ids | Bounds a reply to about 2.2 MB. |
| Sync writes | 120 a minute per account | Relay-side; the relay answers `busy`. |
| Drop chunk | 1 MiB of plaintext | Sealed, that is 1,398,123 characters of base64url: one storage value under the room's 2 MB value limit, and one request. 50 MB takes 50 requests (device RPC's 128 KiB would take 400). |
| File | 50 MiB (50 chunks) | Phones and browsers may hold the whole file to hash it, and uploading over mobile data takes about a minute. Bigger files to a computer go over its own HiveDrop link (200 MB). |
| Waiting per account | 10 of the largest files (about 500 MiB, tags and manifests included), at most 50 drops | Bounds what a stolen credit token can make the room store for a week. Worst-case cost is about $0.10 a month per account. |
| Drop lifetime | 7 days; 24 h if unfinished | The task asked for 7 days. An unfinished drop holds space for no reason. |
| Chunk writes | 240 a minute per account | Relay-side. |
| Tries per chunk | 3 (on `unavailable`, `no-answer`, `busy`) | "Retry one chunk". A send that still fails throws an error that carries the drop id, so the app can resume it. |

## 5. Protocol (all POST, JSON, `x-hivemindos-credit-token`)

Every path is POST. The relay's router and its CORS allow only POST, and the credit token travels in a header,
so `list?since=` became a body field.

| Path | Body | 200 reply | Refusals |
|---|---|---|---|
| `/v1/sync/put` | `{record, base?}` | `{ok, stored: true, seq, evicted}` or `{ok, stored: false, current}` (an older or equal version, or not built on what is held) | 400 for a bad shape, or `{reason: 'stale'}`; 409 `{reason: 'full'}`; 413; 429 `busy` |
| `/v1/sync/delete` | `{record}` with `deleted: true` | the same | the same |
| `/v1/sync/list` | `{since?, epoch?, limit?}` | `{ok, epoch, items, next, more}`: rows with `seq > since`, in seq order. A gone row has no seal. | 400 |
| `/v1/sync/get` | `{ids}` (1 to 8) | `{ok, records (with seq), missing}` | 400 |
| `/v1/drop/put` | `{drop}` | `{ok, have: [indices]}` (the same drop again is a resume) | 400 `stale`; 409 `exists` or `full` |
| `/v1/drop/chunk` | `{dropId, index, envelope}` (exact size) | `{ok, have, complete}` | 400; 404 unknown drop |
| `/v1/drop/list` | `{}` | `{ok, drops: [drop + have + complete]}` | — |
| `/v1/drop/get` | `{dropId, index}` | `{ok, envelope}` | 404 |
| `/v1/drop/delete` | `{dropId}` | `{ok}` | 400 |

`base` on a put is compare-and-swap: "I built this on the version dated `base` (0 for none)". The relay stores
the record only while it still holds exactly that version. Preferences use it. Chats do not need it, because a
chat record has one writer (its id includes the device).

### For whoever builds the Worker

Each test file's `fakeRelay` is the reference room. It calls only the shared rules:

- `parseAccountSync*Body` and `accountSyncTooNew`, then `planAccountSyncWrite(rows, record, base)`. Mark each id
  in `evict` as a `gone` row with a new seq and no seal, delete each id in `drop`, then store the record with
  `accountSyncRowOf(record, ++seq, now)`.
- On a list, start from `accountSyncListSince(body, roomEpoch)`: the body's `since` only when its `epoch` is the
  room's, else 0 (a body with a cursor and no epoch starts from 0 too). Create the epoch once, randomly, when the
  room first keeps sync rows. The client does not rely on this: when the epoch changed under a cursor above 0,
  `pullAccountSync` lists again from 0 itself. The live relay (sync-room.ts) still has its own inline rule, which
  keeps the cursor for a body with no epoch; clients always send one, so they agree. Switch it to the core
  function at its next release.
- `parseHiveDrop*Body` and `hiveDropTimeProblem`, `planHiveDropPut`, `planHiveDropChunk`, `hiveDropRowOf`, and
  `hiveDropListedOf` for lists.

Wiring:

- **Routes and body caps:** add `ACCOUNT_SYNC_PATHS` and `HIVEDROP_INBOX_PATHS` to the router. Cap request bodies
  at `ACCOUNT_SYNC_MAX_REQUEST_CHARS` (about 266 KB) and `HIVEDROP_MAX_REQUEST_CHARS` (about 1.4 MB) instead of
  the device cap, and check content-length first, as the router does now.
- **Storage:** keep heads and bodies under their own keys (`sync:row:<id>`, `sync:head:<id>`, `sync:body:<id>`,
  `drop:row:<id>`, `drop:chunk:<id>:<index>`). A list then reads rows and heads, never bodies, and a chunk read
  loads one value.
- **Atomicity:** one room is one thread, and the room's storage gates keep a read, plan and write atomic as long
  as no outside fetch sits in between.
- **Alarm:** `sweepAccountSync` and `sweepHiveDrops` join the access-row sweep, and the alarm is set to the
  earliest of the three.
- **Sync script:** run with `--only relay` and `HIVE_SHARED_CLOUD` pointing at an export. I did this into a
  scratch export: the relay received exactly the three files, and its self-check passed.

## 6. Behaviour that matters

- **Incognito:**
  - A chat marked incognito is never published.
  - A chat with any message sent with a keep choice other than "account" (`none`, `device`, `local`, or any choice
    this file does not know) is never published either. This matches the desktop's "a thread keeps the most private choice" and the website's
    `roomStaysOffAccount`.
  - A chat that turns private after it was shared is withdrawn: `publishChat(..., {wasPublished: true})` writes a
    sealed delete. When the pool did not take it and still holds the chat live, the outcome is `unchanged` (with
    `current`), not `withdrawn`: keep `wasPublished` and try again on the next change.
  - The desktop never writes a "Don't save" turn, so its server cannot see one in the chat. The window tells it
    instead (`/api/devices/pool`, action `hold`, the thread key only, kept in the server's memory): the pool takes
    the chat's shared copy out at once and shares nothing of it while the window holds it, and shares the saved copy
    again once the window lets it go, or once the chat is saved with a new turn (a reloaded window forgets its marks
    without saying so, and never saves a turn in a chat it holds).
  - The desktop and the phone take chats out before sharing others in a pass, and try a withdraw the pool turned
    away again soon (the desktop on its next 15 s tick, the phone after 30 s); the website keeps it owed and tries
    it on its next pass.
  - Not sharing sends nothing at all (tested).
- **Whose chat it is (2026-10-03, `core/account-owner.ts`):**
  - Before this, a device shared every eligible chat with whichever account was signed in and held its key, so a
    device signed in to account A and later to account B put A's chats in B's pool, where B's other devices could
    read them (found by the D2 and M2 verifiers; the website already kept chats per account in its storage).
  - Every chat a device holds now carries one owner: the account signed in when the device first saw it (desktop:
    `~/.hivemindos/account-pool/owners.json`, owners named as the memo files are, `sha256(brainAccountId)[:32]`;
    website: the account each browser's chats are stored under). A chat is shared or withdrawn only in its owner's
    pool, only while that account is signed in, and only with that account's own key (the desktop checks the key
    here was last found to open that account's key check, `brainKeyAccountId`). A chat owned by another account is
    neither shared nor withdrawn and stays on the device; it goes on when its account is back. A copy another
    account's pool got before this rule is withdrawn from that pool the next time that account is signed in here.
  - Signed out, nothing is stamped or sent. A chat made signed out belongs to the next account signed in. A chat
    is stamped even while the account waits for its key, so the key arriving later, or another account signing in,
    never changes whose it is.
  - When the stamp is taken (desktop): the server's loop looks at the saved chats every 15 s and stamps any new one
    as soon as it sees the change, without waiting for the pass (which waits for the chats to settle, up to two
    minutes while someone is typing). What is left is a chat saved in the few seconds before a switch to a
    different account that is not a merge; switching accounts takes an emailed code, so in practice it is stamped
    first. A stamp whose chat is missing is dropped only after 10 minutes missing, and never when the whole read
    comes back empty (the dashboard state reads as empty when it cannot be read), so a failed read never hands
    chats to whoever is signed in.
  - HiveDrop on the desktop uses the same key check: files are only opened or sealed with the key last found to
    open the signed-in account's key check.
  - Existing chats (migration): the account whose pool record on this device says it was shared there; with no
    record, the account signed in when the new code first sees it. Records from several accounts (the leak above):
    the account signed in now when it is one of them, otherwise the chat waits, shared nowhere, until one is.
  - "Continue here": the window tells the server the new chat's key (`/api/devices/pool`, action `continued`), and
    it belongs to the account signed in then. A stamp never moves this way.
  - Merges: the gateway resolves a merged-away account's sign-in to the survivor (`resolveCreditAccount`), and the
    brain account id is `sha256(ownerKey)`, so a merge (and linking a wallet) changes the id a device sees. On the
    desktop every email sign-in merges the account it held into the signed-in one (`adoptSignIn`), and so does
    `reconcileFleet`. A device treats a change of account as a merge, and carries the old account's chats to the
    new one, only when it is proven: the same sign-in now opens the new account, or (desktop) the old sign-in, kept
    in memory only, is asked of the account service and opens the new account. Anything less (no answer, or a
    restart in between, which forgets the old sign-in) is treated as another account: its chats stay with it,
    shared nowhere, never leaked.
- **Whose brain it is (2026-10-03, desktop `src/lib/services/obsidian/brain-owner.ts`, the same core rule):**
  - Before this, the desktop's account brain sync (`account-brain-sync.ts`) used whichever account was signed in.
    After another account signed in here (with or without a merge), this computer's typed memories went up to that
    account when uploads were on, the names of its workspaces went to that account's list, a backup receipt was
    sent for it, in "keep on my devices" mode its offline copy was sealed into that account's storage, and live
    recall answered that account's devices from this computer's vault (`brain-live-relay.ts` searched the whole
    vault for whoever's key and workspaces it was last given). That account's memories also came down into this
    computer's own Agent Memory shelf.
  - Each workspace on this computer now has one owner, stamped with core `account-owner.ts` helpers in
    `~/.hivemindos/account-brain-sync/owners.json` (workspace id -> `sha256(credit account id)`, the name the
    `Account Brain/<sha>` folders already use). Only the owner, while signed in, syncs it (both directions), gets
    its workspace name and removals, gets its receipt, its offline copy and inbox, and is answered by live recall
    from it. Another account's workspaces are left alone (status `otherAccount`). A workspace the signed-in account
    made on its other devices is still made here, as before, and is that account's own; it never goes to the owner.
  - Live recall answers an ask only while the account its workspaces were given for is still signed in
    (`isCurrent`, checked per ask and again before the answer is sent), so a sign-out or a switch stops answers
    at once, not at the next sync. An ask that finds the sign-in changed takes up what the account signed in now
    owns here (`resumeBrainLiveRecall`, at most once a minute), so the same account with a renewed credential is
    answered again without waiting for a sync. At server start only the signed-in account's own workspaces are
    offered, and an owner ledger that cannot be read offers none.
  - Migration: the replicator's history in the dashboard state (`account-brain-sync:*`, peers `<account id>` and
    `<account id>#<workspace>`) names the accounts each workspace synced with; the core's rule picks from it. On
    the first stamping only, a workspace with no history of its own takes the account(s) the rest of the computer
    synced with. History from several accounts (the leak already happened): the account signed in now when it is
    one of them, otherwise the workspace waits, synced with nobody.
  - Merges: the sync manifest's `accountIds` (gateway `mergedCreditAccountIds`: every credit account merged into
    the one signed in) is the proof. A workspace owned by one of them follows to the survivor (`noteAccountMerge`).
    Nothing else counts, so an unproven switch, or "Keep separate", leaves the computer's brain with its owner.
  - Signed out: the sync needs a session, so nothing goes, and live recall answers nobody.
  - The brain key, one per account (2026-10-04, `brain-device-storage.ts`): `HIVEMINDOS_BRAIN_KEY` in the shared
    credential store is the key of the account the person's computers share, and replicates between them. While a
    computer is held apart from them ("Keep separate" at sign-in, `hivemindos-model-credit-vault.ts`), the key of
    the account signed in there is kept only in that computer's encrypted vault, under a record for that brain
    account. It is never written to the shared store, so it cannot replace the owner's key there or on the other
    computers, and the shared key is never read for that account, so a new account's key check is never sealed
    with the owner's key. The chat pool and HiveDrop ask for the key of the account whose check was opened
    (`readBrainKey(brainAccountId)`). Not held apart, nothing changed: the shared key is read and written as before.
    A computer where another account's key already replaced the shared one before this is not repaired by it.
- **Merging:**
  - Each record keeps the newest `updatedAt`, at the relay and on every device.
  - A newer live version undoes a delete, so a chat continued after it was deleted elsewhere comes back. That is
    newest-wins on purpose.
  - Preferences merge entry by entry, each entry keeping its own time. A tie is broken by comparing the values as
    JSON, so every device picks the same. Keys named like built-in object properties (`__proto__`, `constructor`,
    `toString`...) are refused, and merges read only a document's own entries. A document past 200 entries or
    its 16 KiB seal keeps values before removals, then the newest, in key order, the same on every device, so a
    full one settles instead of being republished on every sync. That holds when each app keeps `merged`
    (entries and times as they are) as the local document it passes next time; a document rebuilt from settings
    brings back entries the cap left out, and a probe of two such devices kept republishing in 52 of 200 runs.
    Past the cap, a removal can be left out before the value it removed, so an older value another device still
    holds can come back. `syncPrefs` pulls first, merges, and publishes with `base`. A test makes
    a device whose clock runs behind publish between another device's merge and its write: without `base` the
    later write erased the earlier device's entry (the mutation check failed), and with it nobody's change is lost.
- **Deletes and gone rows:**
  - A sealed delete names who deleted it.
  - A `gone` row only means the pool no longer holds that chat. A device must never delete its own chat because
    of a gone row. Its time is not sealed, so a device keeps it at the newest sealed time it saw for that record
    (0 with none): a forged far-future gone row cannot hide a real newer version.
  - Whether a delete from another device should also delete the chat on the device it lives on is an app choice
    (open question 3). If an app does act on deletes, it takes them from `accountSyncDeletes` (client
    `deletes(cache)`), which opens each one first: a row that does not open (another key, or written by anyone
    else holding the credit token) is counted, never acted on.
- **A key that changed:**
  - Records under the old key are counted as unreadable and never shown.
  - `syncPrefs` replaces a preference document it cannot open.
  - A chat sealed under the old key stays unreadable until its own device publishes it again, which happens on its
    next change.
- **"Chats on your other devices":** `accountChatSummaries` returns title, device, "5 minutes ago" style times,
  a preview line, the agent and model labels, and the message count, newest first. It leaves out this device's
  own chats unless asked.
- **"Continue here":** `continueAccountChat` turns a chat into plain `{role, content}` messages. Attachment names
  ride along in the message they belonged to. The note reads "Continued from Studio.", plus "Only the latest N
  messages came along." when it is trimmed. The newest message always comes along: when it alone is longer than
  `maxChars`, it is cut to fit (ending in "…", never splitting a character) and the note says so.
- **HiveDrop:**
  - A drop is for one device (by id) or for `any` of the person's devices.
  - `saved()` removes a drop meant for this device alone, and leaves one meant for any device until it expires.
  - A receive opens every chunk, checks each one's exact size, and checks the whole file's SHA-256. With `write`,
    chunks stream out in order; on `damaged` the app must throw away what was written.
  - A send that stops can be resumed with only its drop id, even after the app restarts. The client lists the
    drop, unwraps the file key with the brain key, checks the manifest's hash against the file, and sends only the
    missing chunks.

## 7. A device without the brain key

`accountSyncReadiness({signedIn, accountHasKey, deviceHasKey})` gives one of four states:

- `signed-out`
- `needs-computer`: no device holds a key yet. "Open HivemindOS on your computer and sign in once."
- `needs-key`: the account has a key and this device should offer the **existing** key request, the website's
  `startBrainKeyRequest` or the phone's `brainDevices.requestKey`, approved on a computer with the matching number.
- `ready`

The copy is in `ACCOUNT_SYNC_READINESS_COPY` and `ACCOUNT_SYNC_MESSAGES` / `HIVEDROP_INBOX_MESSAGES`. A test
checks that the copy names no providers or infrastructure and contains no emoji.

`accountHasKey` is "the storage status returned a `keyCheck`", which both apps already read. Every client
function throws `locked` without a key. Nothing degrades to sending unsealed data.

## 8. Decisions, and what I rejected

1. **Keys derived from the brain key**, rather than a new sync key with its own exchange, or reusing
   device-access credentials. It reuses the one approval ceremony people already do. Every device that can read
   the brain can read chats, and no computer has to be online. Per-device-pair keys were rejected: they need n²
   exchanges, and a phone and a browser could not share without a computer awake.
2. **The relay merges on a plain version time, bound into the seal**, rather than devices merging alone. With
   devices alone, an offline device that comes back overwrites newer work, and the relay cannot tell. CRDTs for
   chats were rejected because each chat has one writer.
3. **Per-entry merging plus compare-and-swap for preferences**, rather than one time per document. A whole
   document loses one of two changes made at the same time. Without the swap, a device with a stale copy erased
   other devices' entries; the end-to-end test caught this in my own first draft.
4. **Head and body**, rather than one sealed blob. With one blob, every list would download every chat.
5. **A relay-assigned seq cursor plus an epoch**, rather than a cursor on version time. A version-time cursor
   misses late writes from offline devices, and an epoch lets a reset room restart caches.
6. **The relay ages out the oldest chats**, rather than refusing `full` and making every device prune. Pruning on
   every device races, and each app would need the logic. A gone row also stops an unchanged chat from being
   published again (same version time).
7. **Opaque derived chat ids**, rather than app ids in the open. A desktop's thread ids can carry project names.
8. **JSON and base64url for chunks**, rather than binary bodies. It costs 33% more bytes. React Native's built-in
   fetch handles binary request bodies unevenly, the relay's routes are all text, and the shared validators work
   on JSON.
9. **A random key per file, wrapped**, rather than HKDF of the drop id. It keeps the data under any one key small,
   deleting the wrapped key makes a lingering drop unreadable, and a later "send to someone else" can wrap the
   same key for them without sealing the file again.
10. **The manifest first, then the chunks**, rather than committing at the end. Receivers can show a file as
    arriving, and a resume reads the manifest back. The cost is that a phone without a piece-by-piece hasher
    reads the file twice (once to hash, once to send). A test checks this.
11. **No compression** (Hermes has no `CompressionStream`) and **no size padding** (its cost on every chunk).
    Sizes leak, as recorded in §2.
12. **One-shot SHA-256 is injected as before; a piece-by-piece hasher is optional** (`createSha256`: noble's
    `sha256.create()`, or `createHash` in Node). I did not write a SHA-256 of my own into core.
13. **Not added to the paid gateway's subset.** Only the relay needs these files.

## 9. Open questions

1. **Accounts with no computer.** They never get a brain key, so they get neither feature, or the brain cache. Should a phone or
   the web be able to make the key when the account has none? The desktop's `ensureBrainKey` would then need to
   handle a key made elsewhere: today it asks another desktop, and nobody could approve.
2. **Replacing the brain key** after a lost device. There is no flow for it. With one, each device would publish
   its own chats again; preferences already replace themselves.
3. **What a delete from another device does to the chat on its own device:** remove it there too, or only from
   other devices? The protocol carries who deleted it. My recommendation is pool only, with a "Remove from your
   other devices" action.
4. **Continuing on the computer that owns the chat.** The sealed head carries `device` and `chatId`, which is the
   pointer the parity note asks for. Routing a continue back needs the device-access `chats` scope, which is not
   wired here.
5. **Should desktops poll the inbox too,** so the web can send to a desktop without its HiveDrop link? The
   protocol already allows it (`to` is any device id).
6. **Should a drop for "any" device disappear once one device saves it?** Today it stays until it expires or
   someone removes it.
7. **Fairness between devices.** One device can push another device's chats out of a full pool. The rule is
   newest-wins across the account. A per-device share was rejected for now as complexity.
8. **Pricing and rate numbers** (120 sync writes and 240 chunk writes a minute) are my guesses. The relay has no
   per-feature metering today.
9. **`parity.ts`** said `planned` for `one-chat-pool` and `hivedrop-receive` when this was written. Since
   2026-10-03 it records the pool, settings that follow the account and the inbox on all three surfaces, with what
   still waits for a desktop release or a phone update.

## 10. What was verified, and what was not

Verified (all in this export):

- **Shared tests:** baseline 324 tests, 323 passing. The one failure was a device-access timing test ("a
  response with no stream still works…"), which passed 2 of 2 when run alone; it is a flake under load. Now 354
  of 354 pass (+20 account sync, +10 HiveDrop).
- **Mutation checks** that were caught:
  - removing `base` made 2 tests fail;
  - removing the chunk-count binding made the "cut short" test fail;
  - removing the SHA-256 check made the "damaged" test fail.
- **`test:hive-shared-sync`:** 12/12 before, 13/13 after; the new test is the relay subset.
- **`guard:hive-shared`:** passes, 416 files before and 420 after. Sibling repos are absent next to the export, so
  they were skipped.
- **`test:device-access`:** 20/20 and 4/4 relay-socket checks, the same before and after.
- **ESLint** is clean on all six touched files.
- **`tsc --noEmit`** on the whole desktop project (non-incremental): base exit 0, export exit 0. The first run on
  the export failed with one error, in a test helper's `Buffer.from`; I fixed it.
- **The phone's way:** both new test files, run from a scratch copy laid out like the phone repo (tests run from
  `backend/`, with the phone's own `node_modules`), pass 30/30 with noble **2.4.0**. The phone's TypeScript 5.9.3
  typechecks them with Node and DOM types.
- **The relay subset compiles without DOM or Node types**, with a `TextEncoder` declaration standing in for Workers
  types. Leaving out that declaration gives 3 errors, which proves no DOM type leaked in.

Not verified:

- The real Worker typecheck: `@cloudflare/workers-types` is not installed anywhere on this Mac.
- Any Worker, phone or browser running this code.
- Hermes performance on 1 MiB chunks: base64 and noble AES-GCM speed on a phone are unknown.
- The website's own `tsc`, and the phone's own Expo `tsc` config, on the synced files: not run, because the
  copies are synced only by the orchestrator. The phone's TypeScript with Node and DOM types did pass.
