# Managed Memory And Knowledge

> https://hivemindos.app/superagent-api/docs/memory · Markdown version: https://hivemindos.app/superagent-api/docs/memory.md

# Managed memory and knowledge

Cloud Superbrain (`cloud-superbrain`) lets a hosted app remember useful context between calls. It saves facts and decisions, finds them by words or meaning, answers from them with citations, and keeps earlier versions when something changes.

Each HivemindOS account gets an isolated memory store; no desktop session or Obsidian vault is needed. A project-bound key, or a request for one of your app's end users, gets a brain of its own inside the account, sharing the account's plan and allowance. See [one brain per project or user](#one-brain-per-project-or-user). Use the local [Hive Superbrain](https://hivemindos.app/docs/for-users/whole-brain/brain-services.html) instead when a user's Obsidian vault should stay the editable source of truth.

## Costs

| Mode | Operation | Result | Charge |
|---|---|---|---:|
| Lexical search | `memory.search` | Fast matches from titles, content, tags, projects, entities, aliases, and usage. | 0 credits |
| Semantic recall | `memory.recall` | Hybrid meaning and keyword matches, with the evidence used for ranking. Add `rerank: true` to have the best 20 read again against the question. | 1 credit |
| Memory Answer | `memory.answer` | A concise answer grounded in returned memories, plus cited memory ids. Add `stream: true` to get it as it is written. | 5 credits with the default reader |
| Erase an end user | `memory.erase` | Everything one of your app's end users has in memory, gone in one call. | 0 credits |

Semantic Recall and Memory Answer are paid per use from the account's credits; no plan is needed. Lexical search, storage within the plan, history, graph reads, capsules, and health checks use no agent credits. Call `catalog.get` when onboarding an account to show its plan, storage limits, and availability.

Indexing runs when memory changes, so there is no idle charge. A new memory is searchable by keyword at once and joins Semantic Recall when its index status is ready; `memory.health` reports that state.

## Save a memory

Only `title` and `contentText` are required. Add a stable `memoryKey` when later calls should update one subject instead of creating new records.

```ts
const saved = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.create",
  {
    title: "Aurora compute funding decision",
    contentText: "Compute capacity starts only after the customer-funded job is accepted.",
    memoryKey: "decision:aurora-compute-funding",
    memoryType: "decision",
    project: "Aurora",
    confidence: 0.96,
    tags: ["compute", "commercial"],
    entities: ["Project Aurora", "Hive Compute"],
    evidenceCount: 3,
  },
  { idempotencyKey: "aurora-compute-decision-v1" },
);

if (!saved.ok) throw new Error(saved.error);
const memoryId = saved.result.memory.id;
```

- Memory types: `instruction`, `fact`, `decision`, `goal`, `commitment`, `preference`, `relationship`, `context`, `event`, `learning`, `observation`, `artifact`, `error`, `action`, and `knowledge`.
- Optional fields: `path`, `kind`, `mimeType`, `mediaUrl`, `links`, `metaTags`, `aliases`, `sourceType`, `actorRole`, `memoryOrigin`, and `cognitiveStage`.
- `memory.batch` saves up to 25 records; each returns its own id and generation receipt.
- `occurredAt` dates a memory written after the fact, such as one you import from another system: `"2026-09-25"` or a full ISO time like `"2026-09-25T14:30:00Z"`. Recall ranks the memory by it, and Memory Answer shows the reader that date instead of the day you saved it, so "my driving test is tomorrow", said on the 25th and imported on the 30th, is not read as still to come. It cannot be in the future (a clock up to five minutes fast is allowed) or before 1900; either is refused with 400. Every memory returns `occurredAt`, or `null` when it is dated by when it was written. `memory.update` keeps it unless you send a new one (`null` clears it); `memory.evolve` dates the new version now unless you pass one; `capsules.import` keeps each memory's original time.
- Content that looks like a credential, private key, bearer token, seed phrase, or mnemonic is rejected. Store the credential's name and whether it is set, and keep the value in a secret manager.

## Search and answer

Lexical search is free and predictable, good for autocomplete and retrieval before a model call:

```ts
const search = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.search",
  undefined,
  {
    query: {
      q: "customer-funded compute",
      project: "Aurora",
      memoryType: "decision",
      limit: 8,
    },
    idempotencyKey: "aurora-memory-search-001",
  },
);
```

Semantic recall finds memories even when the wording differs:

```ts
const recalled = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.recall",
  {
    query: "Who pays before an Aurora GPU starts?",
    mode: "hybrid",
    project: "Aurora",
    limit: 8,
  },
  { idempotencyKey: "aurora-memory-recall-001" },
);
```

Add `rerank: true` when the order matters, for example when an agent will read only the first few results. The best 20 matches are read again against the question and the most relevant are put first. It takes about a second longer and costs the same 1 credit, and the response says `reranked: true`. Only memories saved in the standard tier are read again; private and confidential ones keep their place. If the second read cannot run, you get the usual order and `reranked: false`. Rerank runs only in the standard tier: under the private or confidential base it is refused (409 `STANDARD_TIER_REQUIRED`), or, with `keywordFallback: true`, skipped with `rerankSkipped: "privacy-tier"`.

**Where the second read runs.** The second read is made by a reranking model at a third-party model provider (OpenRouter), not by HivemindOS. With `rerank: true`, the question and the text of up to 20 standard-tier memories (up to 12,000 characters of each) are sent to that provider, under its own terms. Memories saved in the private or confidential tier are never sent. Leave `rerank` off if your standard-tier memories must not leave HivemindOS.

On LongMemEval_S (500 questions, each answer among about 50 past conversations), recall puts the conversations that hold the answer in its top 5 97.7% of the time with `rerank: true`, and 93.7% without it. Both were 90.7% before September 28, 2026. [How it was measured](https://hivemindos.app/docs/for-users/features/shared-brain-benchmarks.html#hosted-memory-search-accuracy).

Memory Answer returns a finished, grounded response:

```ts
const answered = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.answer",
  {
    query: "What is the Aurora compute funding policy?",
    limit: 8,
  },
  { idempotencyKey: "aurora-memory-answer-001" },
);

console.log(answered.result.answer);
console.log(answered.result.citedMemoryIds);
```

If no memory supports an answer, the request returns not found and releases the credit reservation, so you are not charged. For a question of four or more words, a memory counts as support when it matches at least two of the question's words, the exact phrase, or its meaning; one shared word is not enough. When the only candidates are weak meaning matches (see below), the answer model reads the best three; if its answer cites none of them, you get the same not-found reply and are not charged.

About results:

- Every hit includes its memory fields, an excerpt (the part holding the most question words), a total score, matched signals, and score details.
- A hit matched only as `semantic-weak` is close in meaning but not close enough to count as a strong match. Weak matches rank below every strong or worded match, so a short fact phrased differently from the question ("what pet do I have" against "I adopted a grey cat") is still found. Check the score before relying on one.
- Search matches word forms (`weddings` finds `wedding`), and rare words count for more than common ones.
- Operational memories such as action and handoff receipts are left out of default recall. Ask for a specific operational `memoryType` or set `includeOperational: true` when you want them.
- Set `trackUsage: false` for diagnostic lookups that should not affect usage ranking. `memory.usage` records retrieved or final-answer use for known memory ids.
- `memory.search` responses include `Server-Timing: memory;dur=<ms>`, the search's own time without network. `memory.recall` and `memory.answer` include a breakdown: `owner`, `embed`, `vector`, `lexical`, `rows`, `rerank`, `reader`, `meter` and `total`, in milliseconds.

To limit an answer-only worker, allow just `services.invoke.cloud-superbrain.memory.answer` and set a request limit on that exact selector.

### Stream the answer

Add `stream: true` to `memory.answer` to show the answer as it is written instead of after the whole of it. The response is server-sent events (`text/event-stream`) instead of the JSON envelope:

| Event | Data |
|---|---|
| `meta` | Everything the buffered answer returns except `answer`: hits, `citedMemoryIds`, `reader`, `privacy`, the conversation evidence, and `chargedCredits`. Sent first. |
| `delta` | `{ "text": "..." }`: the next part of the answer. |
| `done` | `{ "answer": "...", "chargedCredits": 5 }`: the whole answer, once it is complete. |
| `error` | `{ "error": "...", "chargedCredits": 5 }`: the reader stopped after it started. |

It costs the same as a buffered answer, charged once. The charge is settled when the reader's first words arrive, before the stream starts, and the response's `X-HivemindOS-Credits-Charged` header says how much. So a reader that fails before writing anything is not charged, and you get the usual JSON error instead of a stream. An answer you stop reading halfway, or one cut off by an `error` event, was still charged once and is not charged again. A request that finds nothing returns the same not-found JSON as without `stream`, uncharged. When the only candidates are weak meaning matches, the answer is read whole first (it is charged only if it cites them) and arrives as one `delta`. A stream is not replayed for a repeated idempotency key; `mode: "evidence"` has no answer to stream and refuses `stream: true`.

With the SDK:

```ts
import { collectMemoryAnswer } from "@hivemindos/sdk";

const started = await hive.memory.answerStream({ query: "When is my driving test?" }, { endUserId: "user-42" });
if (!started.ok) throw new Error(started.error);
for await (const event of started.events) {
  if (event.type === "delta") process.stdout.write(event.text);
}
// Or read it whole: const { answer, complete } = await collectMemoryAnswer(started);
```

Measured on 2026-10-06 through `/v1` with the SDK and the default reader (10 answers each, median): a paragraph-long answer's first words arrived in 1.03 s against 1.89 s for the buffered answer; a one-sentence answer in 0.99 s against 1.21 s; a "when" question, which the reader reasons about before it writes, in 2.15 s against 2.35 s. The longer the answer, the more streaming saves.

## Choose who reads the answer

Memory Answer has a default reader, and you can name another. `memory.models` lists every model that can read an answer, with its privacy tier, reasoning settings, per-token price, and the most one answer can cost. The default is marked `default: true`. It needs no key.

```ts
const readers = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.models",
  {},
  { idempotencyKey: "memory-readers-001" },
);
```

Pass a reader's `id` as `model`, and `reasoningEffort` (`none`, `low`, `medium` or `high`) when that reader lists it:

```ts
const answered = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.answer",
  {
    query: "What is the Aurora compute funding policy?",
    model: "@cf/openai/gpt-oss-120b",
    reasoningEffort: "medium",
  },
  { idempotencyKey: "aurora-memory-answer-002" },
);

console.log(answered.result.reader);
```

A setting a reader does not take is refused before anything is charged, never quietly changed. The response's `reader` names the model that answered.

**Price.** With the default reader, an answer costs 5 credits. Another reader adds what it costs above the default for the same question, at HivemindOS rates, rounded up to a whole credit. A reader that costs less than the default still costs 5 credits. The answer first reserves the reader's `maximumCredits`, then charges for the question actually sent and releases the rest.

**Private and confidential answers.** Pass `private: true`, or call through the private base URL, to have the answer read only by a model that keeps nothing it is sent. Under the confidential base, name a reader that runs in an attested enclave as `model`; there is no default there. In both cases the answer never uses Turbo ordering, and `turbo: true` is refused. `memory.models` under a tier's base, or with `privacy` in its query, lists the readers that qualify.

A memory keeps the strictest tier it was written in and is read only by a reader that meets it. See [private and confidential access](privacy.html).

Measured reader accuracy and speed are on the [memory benchmarks](benchmarks.html) page.

## Past conversations

Save a chat transcript as a memory and recall reads it exchange by exchange. A memory is read as a transcript when its turns are marked `**User:**` and `**Assistant:**` (or an agent's name), or when its lines start with `User:` and `Assistant:`. Put the conversation's date in the frontmatter as `startedAt` or `date`; otherwise the save date is used.

```ts
await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.create",
  {
    title: "Support chat with Dana",
    path: "Conversations/2026-09-14-dana.md",
    contentText: [
      "---",
      "startedAt: 2026-09-14T15:02:00Z",
      "---",
      "User: The replacement blender arrived cracked, same as the first one.",
      "Assistant: Sorry about that. I've refunded the second order to the original card.",
    ].join("\n"),
  },
  { idempotencyKey: "support-chat-dana-0914" },
);
```

When a search or recall returns a transcript, the response also carries `conversationEvidence`: the best-matching exchanges across the account's transcripts, oldest first under each conversation's date. `conversationEvidenceMemoryIds` names their memories.

| Field | Default | Effect |
|---|---|---|
| `evidenceChars` | 4,200 | The size of `conversationEvidence`, from 1,000 to 24,000 characters. |
| `evidence` | On, except at `detail: "abstract"` | `false` leaves the exchanges out; `true` adds them at any detail tier. |

Memory Answer reads the same exchanges plus the best part of every other supporting memory, and knows today's date, so "how long ago" and "which came first" questions work. If the conversations fit, it reads them whole. If not, and you pass `turbo: true`, the Turbo decision model orders the exchanges by how likely each is to hold the answer, and the answer reads excerpts from the best 12,000 characters. The decision model is not private, so it is used only when every exchange was written in the standard tier, and never for a private answer. Turbo also reads the best 20 candidate memories again against the question before choosing which conversations to read, the same second read as `rerank: true` in recall. Both run at a third-party model provider (OpenRouter): the question, the exchanges, and the candidate memories' text are sent to it under its own terms. Turbo is off unless you pass `turbo: true` (since 2026-09-29); without it the answer keeps keyword order and sends nothing to that provider. The response's `turbo` says whether it ran. The response's `evidenceOrder` says which order was used (`keyword` when conversations were read whole). Neither choice changes the price.

## One brain per project or user

When a request is made with a project-bound key, with `X-HivemindOS-Project`, or for one of your app's end users (`X-HivemindOS-End-User`, or a key bound with `endUserId`), Cloud Superbrain reads and writes a separate brain for that project, that end user, or that end user within that project:

- It starts empty and never sees the account's own memories, or a desktop brain synced to them. The account's own requests never see it.
- Ids, memory keys, history, and search stay inside it. An id from another brain is not found.
- It uses the account's plan. Every brain in the account shares the plan's one allowance.
- Buying a plan and syncing a desktop brain need an account-level request; a scoped request is refused.

See [projects and isolation](projects-security.html#act-for-one-of-your-apps-users) for how to name an end user.

### Erase an end user's memory

When one of your app's users deletes their account, `memory.erase` removes everything they have in memory in one call: every memory, its past versions, its search indexes, and the brain's history. It is free, needs no approval, and is safe to repeat.

```ts
const erased = await hive.memory.erase({ endUserId: "user-42" });
// Same as hive.services.invokeOperation("cloud-superbrain", "memory.erase", {}, { endUserId: "user-42" })
if (!erased.ok) throw new Error(erased.error);
console.log(erased.result.memoriesErased, erased.result.complete);
```

- **Only one end user, only yours.** It erases the brain of the end user the call names, inside the key's own account and project, and nothing else: not another end user, not another project's brain for the same end user id, not the account's own memories. The end user comes from a key bound with `endUserId` (which erases only its own end user, and cannot name another) or from `X-HivemindOS-End-User` on an unbound key. A call that names no end user is refused with 400 `end_user_required`; an account's or a project's whole brain cannot be erased this way.
- **Which keys can call it.** Any key with the `services:invoke` scope whose operations include `services.invoke.cloud-superbrain.memory.erase` (a key with no operation list has every operation). To give an app server only this, allow just that selector. A key bound to an end user can erase only that end user, so a key you hand to a user's device can erase that user and no one else.
- **Repeating is safe.** A second erase finds nothing and returns `memoriesErased: 0`. A very large brain (over 5,000 memories) returns `complete: false`; call again until `complete` is true.
- **Audited.** Each erase leaves a record of when it ran, for which account and project, and how many memories went. It holds no memory content and not the end user's id. The call also appears in your [usage and audit events](usage-audit.html).

## Ask for only as much as you need

Recall returns whole memories by default. Pass `detail` to get less:

| `detail` | Each hit carries | Good for |
|---|---|---|
| `abstract` | Id, title, type, project, status, updated date, score, and a one-line excerpt. | Surveying candidates, then re-requesting the few that matter. |
| `overview` | The full metadata record, ranked excerpt, and score details — no body. | Ranking and filtering when the body is not needed yet. |
| `full` | Everything, including `contentText`. **The default.** | Reading the memory. |

```ts
const survey = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.recall",
  { query: "Who pays before an Aurora GPU starts?", mode: "hybrid", detail: "abstract", limit: 8 },
  { idempotencyKey: "aurora-memory-survey-001" },
);
```

`detail` only trims the response. It never changes which memories rank, their order, what `memory.answer` is grounded on, or the price. The response echoes the `detail` it applied.

## Change, replace, or delete a memory

When new information replaces an active memory, use `memory.evolve`. The old record becomes `superseded`, the new one becomes the active head, and both stay linked.

```ts
const evolved = await hive.services.invokeOperation(
  "cloud-superbrain",
  "memory.evolve",
  {
    contentText: "Aurora capacity starts only after the customer's maximum charge is reserved.",
    evolutionReason: "Clarified when funding is secured.",
  },
  {
    pathParameters: { memoryId },
    idempotencyKey: "aurora-compute-decision-v2",
  },
);
```

- `memory.update` edits the current record in place, for metadata or wording fixes that do not change the underlying truth.
- `memory.delete` permanently removes a memory and requires an exact SuperAgent approval. An operation-only deletion key needs `services.invoke.cloud-superbrain.memory.delete`, `approvals.create`, and `approvals.decide` in `allowedOperations`; add `apiKeys.revoke` only if the worker must also revoke its own key. Prefer archiving or evolving when history matters.

## Maintenance and history

- **Find duplicates:** `memory.consolidate` groups near-duplicates within a memory type, spots memories that say they correct an earlier note but were written without `supersedes`, and lists aged-out memories nothing has retrieved. It reports rather than merges: each group comes with the exact `memory.evolve` call to review. With `applyArchives: true` it archives aged-out candidates (reversible, and only `context`, `event`, `observation`, and `action` memories older than 120 days with no retrieval history). `memory.health` also reports `duplicatePressure` for scheduled checks.
- **Learn from what agents did:** `memory.minePatterns` reads operational memories and proposes recurring failures, workflows worth turning into a skill, and operations stable enough to schedule. Test traffic and retries of one task are not counted. It never creates anything; send a candidate to `memory.create` to keep it.
- **Browse by path:** `memory.browse` summarizes path groups without bodies (about 100 tokens per group at `abstract`, about 2,000 at `overview`). `memory.recall` with `mode: "hierarchical"` scores groups first, so a memory's neighbours come back with it. Hierarchy only changes order; it never hides a memory.
- **Replay history:** each write publishes an immutable generation. `generations.list` reads retained generations and the replay boundary; `generations.compare` shows added, removed, and changed ids between two. `memory.recall` with `generationId` replays a lexical question against an old state; `temporalMode: "historical"` includes superseded and archived records, and `temporalMode: "as-of"` with `asOf` sets a time cutoff. Up to 256 generations are kept per account. A request outside the replay boundary fails rather than using newer memory.
- **Knowledge graph:** memories with type `knowledge`, a `knowledge` tag, or a path under `Synthesis/` become knowledge nodes. Use `knowledge.search`, `knowledge.get`, `knowledge.backlinks` (connections through entities, aliases, and links), and `knowledge.graph` (a bounded node-and-edge view). Use `entities`, `aliases`, and `links` consistently for dependable navigation.
- **Portable capsules:** `capsules.export` returns a checksummed capsule of selected memories or the next page of the account; export at most 100 memories per part and follow `hasMore` and `nextCursor`. `capsules.import` checks the schema and hash before adding records to the authenticated account; it can never grant access to the source account or overwrite another account's memory. `capsules.open`, `capsules.search`, and `capsules.preview` inspect a capsule and report what an import would change without writing anything; a damaged capsule is still shown, with a warning. The checksum detects corruption but is not encryption, so keep private capsules private.

## All operations

| Operation | Method | Purpose |
|---|---|---|
| `catalog.get` | `GET` | Read plans, limits, features, and current charges. |
| `memory.snapshot` | `GET` | Read the account's current managed-memory snapshot. |
| `memory.get` | `GET` | Read one memory by id. |
| `memory.create` | `POST` | Create or upsert one memory. |
| `memory.update` | `PATCH` | Update one current memory. |
| `memory.delete` | `DELETE` | Permanently delete one memory after approval. |
| `memory.erase` | `POST` | Erase everything one end user has in memory, for account deletion. Free, no approval. |
| `memory.batch` | `POST` | Create up to 25 memories. |
| `memory.evolve` | `POST` | Create a new canonical head and supersede the old one. |
| `memory.search` | `GET` | Run lexical search. |
| `memory.recall` | `POST` | Run paid hybrid semantic recall. |
| `memory.answer` | `POST` | Return a paid grounded answer with citations; `stream: true` sends it as it is written. |
| `memory.models` | `GET` | List the models that can read a Memory Answer, with prices. |
| `memory.usage` | `POST` | Record retrieved or final-answer use. |
| `memory.health` | `GET` | Read plan, index, generation, duplicate pressure, and usage health. |
| `memory.consolidate` | `POST` | Report duplicate pressure, missed corrections, and aged-out memories. |
| `memory.minePatterns` | `POST` | Propose recurring failures, reusable workflows, and routines from operational memories. |
| `memory.browse` | `POST` | Survey memory paths at the abstract or overview tier. |
| `index.rebuild` | `POST` | Rebuild indexes after an import or repair. |
| `generations.list` | `GET` | List retained immutable generations. |
| `generations.compare` | `POST` | Compare two retained generations. |
| `capsules.export` | `POST` | Export a checksummed capsule part. |
| `capsules.import` | `POST` | Verify and import a capsule part. |
| `capsules.open` | `POST` | Read a capsule's manifest, integrity, and contents without importing. |
| `capsules.search` | `POST` | Search inside a capsule without importing it. |
| `capsules.preview` | `POST` | Report what importing a capsule would change. |
| `knowledge.search` | `GET` | Search knowledge nodes. |
| `knowledge.get` | `GET` | Read one knowledge node. |
| `knowledge.backlinks` | `GET` | Read backlinks for a knowledge node. |
| `knowledge.graph` | `GET` | Read a bounded knowledge graph. |

## Related

- [Memory benchmarks](benchmarks.html)
- [Authentication and API keys](authentication.html)
- [Per-endpoint limits](limits.html)
- [Local Hive Superbrain](https://hivemindos.app/docs/for-users/whole-brain/brain-services.html)
