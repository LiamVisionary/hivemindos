# AI web search

> https://hivemindos.app/superagent-api/docs/answer-engine · Markdown version: https://hivemindos.app/superagent-api/docs/answer-engine.md

The `answer-engine` service searches the web, reads the pages that matter, and writes an answer with numbered citations. You send a question and get back the answer plus the sources it was built from.

The request and response shapes match the open-source [Vane](https://github.com/ItzCrazyKns/Vane) search API, so a Vane client works here with only the address and authorization header changed.

## Ask a question

```ts
const result = await hive.services.invokeOperation(
  "answer-engine",
  "searches.create",
  {
    query: "How well do heat pumps work below freezing?",
    optimizationMode: "balanced",
    sources: ["web"],
  },
  { idempotencyKey: "heat-pump-question-001" },
);

console.log(result.result.message);   // the answer, with [1] style citations
console.log(result.result.sources);   // what each citation number points to
```

Each source carries the page title and address, so you can render citations as links:

```json
{
  "message": "Modern cold-climate units keep working near -25 °C [1], though their efficiency falls as it gets colder [2].",
  "sources": [
    { "content": "…", "metadata": { "title": "Cold climate heat pumps", "url": "https://example.com/a", "source": "web", "read": true } },
    { "content": "…", "metadata": { "title": "Efficiency in winter", "url": "https://example.org/b", "source": "web", "read": false } }
  ]
}
```

A source with `read: true` was opened and read in full; the rest are search results with their summary text.

A key needs `services:read` and `services:invoke`, with `answer-engine` in its allowed services. Restrict it to `answer-engine.searches.create` if that is all it should do.

## Choose how hard it looks

| `optimizationMode` | What it does | Use it for |
|---|---|---|
| `speed` | One search pass, answers from search results | Quick lookups |
| `balanced` | A few search passes, reads the best pages | The everyday default |
| `quality` | Many search passes, reads more pages, writes a report | Research worth the extra time and credits |

## Choose where to look

`sources` picks which parts of the web are searched. Ask for more than one when the question needs both.

| Lane | Covers |
|---|---|
| `web` | The open web |
| `discussions` | Forums and community answers |
| `academic` | Papers, preprints, and journals |
| `documents` | Text you sent with the request |

A lane is used only when the question calls for it, so asking for all of them costs nothing extra on a question that needs none.

To limit sites, pass `includeDomains` (search only these) or `excludeDomains` (never these). Plain site addresses work; `https://` and trailing slashes are tidied away.

```ts
const result = await hive.services.invokeOperation(
  "answer-engine",
  "searches.create",
  { query: "transformer scaling laws", includeDomains: ["arxiv.org", "nature.com"] },
  { idempotencyKey: "scaling-laws-001" },
);
```

## Answer from your own documents

Send the text with the request and add `documents` to `sources`. Nothing is stored: the text is used for this one search and then discarded.

```ts
const result = await hive.services.invokeOperation(
  "answer-engine",
  "searches.create",
  {
    query: "What COP did unit 3 measure at -19 °C?",
    sources: ["documents"],
    documents: [{ title: "Site log", text: "At -19C the measured COP was 1.9…" }],
  },
  { idempotencyKey: "site-log-question-001" },
);
```

Ask for `["documents", "web"]` and both feed one answer, with citations telling them apart.

## Extras

- **Images and videos:** set `includeMedia: true` and they come back alongside the answer, but only when they help ("what does a heat pump look like" gets images, "what does a heat pump cost" does not). Images carry their licence and source page. You can also call `images.search` or `videos.search` on their own with a `query`.
- **Instant answers:** arithmetic, currency conversion, weather, and crypto prices come back in a `widgets` array with the answer already worked out, at no extra model cost. Share prices are not offered, because there is no keyless quote source HivemindOS trusts.
- **Follow-up questions:** set `includeSuggestions: true` to get a few follow-ups aimed at what the answer left open.

## Stream the answer

Set `stream: true` to receive the answer as it is written, as newline-delimited JSON (one object per line):

| Frame | Meaning |
|---|---|
| `init` | The stream is open |
| `session` | The search's id, for reconnecting |
| `step` | Progress: what is being searched or read now |
| `widget` | An instant answer |
| `media` | Images or videos, when asked for |
| `sources` | The full source list, sent before the answer text |
| `response` | A piece of the answer |
| `suggestions` | Follow-up questions, when asked for |
| `error` | Something went wrong; the stream still closes cleanly |
| `done` | The answer is complete |

Show `step` frames to display progress, or ignore them and wait for `response`.

If the connection drops, reconnect with the id from the `session` frame (also in the `x-hivemindos-answer-session` header):

```ts
await hive.services.invokeOperation("answer-engine", "searches.reconnect", {}, {
  pathParameters: { searchId },
  idempotencyKey: `reconnect-${searchId}`,
});
```

Everything produced so far replays, then live frames continue. The search keeps running while you are disconnected, so no paid model time is lost. You can reconnect for fifteen minutes after the answer finishes.

## Models and cost

List answer models with `models.list`. Pass a `chatModel` to pick one, or leave it out for the recommended default. Answers are billed to the same Agent Credit balance as the rest of the API, and this service adds no charge on top of the model it uses.

The HivemindOS desktop app has the same search under **Search**, where it can use a model on your own computer so nothing leaves it.

## What it will not do

- Answer from memory when the sources do not cover the question. It says what is missing instead.
- Cite a page it did not retrieve.
- Repeat one story five times because five outlets carried it: near-identical results fold into one citation.
- Follow instructions found on a web page. Page text is treated as untrusted content.

## Related

- [SuperAgent API quickstart](./)
- [Service access](services.html)
- [Endpoint limits](limits.html)
