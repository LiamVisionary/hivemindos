# Service Access And Catalog

> https://hivemindos.app/superagent-api/docs/services · Markdown version: https://hivemindos.app/superagent-api/docs/services.md

# Service access and catalog

The service catalog tells you what your key can use and whether it is ready now. Read it before showing a feature or starting work.

## List services

```ts
const response = await hive.services.list({ probe: true });
if (!response.ok) throw new Error(response.error);

for (const service of response.services) {
  console.log(service.id, service.status, service.operations);
}
```

The list is already filtered to the key's permissions. Each service has a `status`:

- `available`: ready to use.
- `setup-required`: the account owner must finish setup first.
- `coming-soon` or `unavailable`: do not keep retrying.

Pass `probe: true` when you need a fresh health check from every visible service.

| Field | Meaning |
|---|---|
| `id` | Stable service id used in keys, invocations, runs, events, and limits. |
| `name` and `description` | What the service is for. |
| `category` | `agent`, `app`, `data`, `finance`, `integration`, `media`, or `platform`. |
| `status` | `available`, `setup-required`, `coming-soon`, or `unavailable`. |
| `operations` | Dedicated SuperAgent API routes or the managed-service invocation route. |
| `operationCount` | Number of registered exact capabilities. |
| `capabilitiesUrl` | Filtered capability registry for the service. |

## Invoke a service

Most managed services share one route:

```http
POST /v1/services/{serviceId}/invoke
```

Name a stable operation id from `GET /capabilities/{serviceId}` and pass its input. The SDK does this with `invokeOperation`:

```ts
const result = await hive.services.invokeOperation(
  "hive-research",
  "analyses.create",
  { question: "What evidence would falsify this thesis?" },
  { idempotencyKey: "falsify-thesis-001" },
);
```

Over HTTPS, the body looks like this. Path parameters and query values stay separate from `input`:

```json
{
  "operationId": "analyses.get",
  "pathParameters": { "analysisId": "analysis_123" },
  "query": { "includeSources": true }
}
```

Always send an `Idempotency-Key`, even for a read-like operation: the invocation itself is a protected mutation.

The response wraps the service's result:

```json
{
  "ok": true,
  "serviceId": "hive-research",
  "operationId": "analyses.create",
  "status": 200,
  "chargedCredits": 0,
  "result": {
    "ok": true,
    "report": {}
  }
}
```

`chargedCredits` is the exact completed charge reported by the service. It is `0` for free reads and for work that did not complete. The same value is in the `X-HivemindOS-Credits-Charged` header and in usage and audit records.

Good to know:

- An older form with `method` (`DELETE`, `GET`, `PATCH`, `POST`, or `PUT`, default `POST`) and a `path` starting with `/` still works for reviewed paths. Registered operation ids are safer: they validate the method and path, work with exact key access, and stay discoverable.
- Account, payment, credential, administrative, and other private service routes are always rejected.
- Managed databases, wallets, and trading use their own [dedicated endpoints](reference.html#endpoint-map) with narrower scopes.
- For work that should continue after the request ends, create a [durable run](runs-webhooks.html#durable-runs) instead. Direct calls and runs have separate [limit selectors](limits.html#limit-selectors).

## Service notes

### Memory

Cloud Superbrain covers typed memory, evolution, lexical search, paid semantic recall, grounded answers, generations, capsules, and knowledge graphs. See [managed memory and knowledge](memory.html).

### Media

Media Studio, Managed Media, and Photo Keyworder use the same Agent Credit balance as every other paid capability. A media request reserves its charge up front, failed work returns the reservation, completed work settles the exact charge, and an idempotent replay never charges again. Photo analysis is charged only after the result completes. The charge is in `chargedCredits` and `X-HivemindOS-Credits-Charged`.

Managed Media picks the lowest-priced healthy route for the model you asked for. If that route fails, the same job can continue on another route for the exact same model without reserving credits twice. The quote shows the expected price and the highest possible reservation across these fallbacks; anything unspent is returned when the job finishes. A content or safety rejection does not try another route.

GPT Image 2 uses medium quality when `quality` is omitted. Use `quality: "low"` for a cheaper draft or `quality: "high"` for maximum detail. Fallback keeps the quality you chose.

```ts
const request = {
  model: "gpt-image-2-text-to-image",
  input: {
    prompt: "A polished studio photograph of a black honey jar",
    aspect_ratio: "1:1",
    // quality is optional; GPT Image 2 defaults to "medium"
  },
};

const quoted = await hive.services.invokeOperation(
  "managed-media",
  "quotes.create",
  request,
  { idempotencyKey: "honey-jar-quote-v1" },
);
const expectedPriceUsd = quoted.result.quote.priceUsd;

const created = await hive.services.invokeOperation(
  "managed-media",
  "generations.create",
  { ...request, maximumDebitUsd: quoted.result.quote.fallbackMaximumUsd },
  { idempotencyKey: "honey-jar-v1" },
);

const finished = await hive.services.invokeOperation(
  "managed-media",
  "generations.get",
  undefined,
  {
    pathParameters: { jobId: created.result.job.id },
    idempotencyKey: "honey-jar-status-v1",
  },
);
```

Poll `generations.get` until the job is finalized. `finished.result.job.outputs` holds ready-to-use media links. Managed GPT Image 2 files are kept for 30 days, so copy anything you need longer into your own storage.

Photo Keyworder takes an inline image for small requests, or one managed JPEG, PNG, or WebP [file](files-connections.html) up to 8 MB. Managed files avoid the JSON request limit and are the better choice for normal photos:

```ts
const result = await hive.services.invoke(
  "photo-keyworder",
  {
    operationId: "photos.analyze",
    input: { context: "Describe only what is visible." },
    files: [{ fileId: uploadedPhoto.id }],
  },
  { idempotencyKey: "photo-analysis-2026-08-27" },
);
```

The analysis service does not keep the uploaded pixels. The managed file stays in your account until you delete it.

### Distill

Upload managed files with `runs.create`, inspect the outline with `runs.get`, choose section ids with `runs.select`, advance the run with `runs.step`, and optionally publish the finished artifact with the approval-bound `runs.share`. `shared.get` reads only the published artifact; uploaded source files stay private.

### Swarm

Start a single-scenario run with the `swarm` service's `runs.create`, then read it with `runs.get`. The work continues in the background even if your app disconnects. An interactive client can call `runs.step` for the lowest latency; repeated calls are safe and never start duplicate work.

### Managed agents and workflows

Managed agents are persistent cloud services, not remote-control desktop sessions. Read the plan catalog with `GET /pricing?service=managed-agents` before creating one. Running and retained agent time use the same account credit balance as other managed work.

```ts
const created = await hive.services.invokeOperation(
  "managed-agents",
  "agents.create",
  { name: "Support operator", planId: "small", modelTier: "fast" },
  { idempotencyKey: "support-agent-v1" },
);
```

The managed-agent service allows the account overview and tenant-owned `/v1/agents...` operations. Managed workflows are limited to an agent's `/v1/agents/{agentId}/routines...` operations:

```ts
const routine = await hive.services.invokeOperation(
  "managed-workflows",
  "routines.create",
  {
    name: "Daily inbox review",
    triggerKind: "cron",
    cronExpression: "0 9 * * *",
    timezone: "America/New_York",
    prompt: "Review new support requests and prepare a prioritized brief.",
  },
  { pathParameters: { agentId }, idempotencyKey: "support-daily-review-v1" },
);
```

### Lead Generation

`leadgen-data` is a live managed service for finding and enriching businesses without a separate data-provider account. Every call uses the account's HivemindOS balance and reports its charge in the normal usage and audit records.

Read availability and the current allowance before a batch:

```ts
const catalog = await hive.services.invokeOperation(
  "leadgen-data",
  "catalog.get",
  undefined,
  { idempotencyKey: "lead-catalog-2026-08-25" },
);
```

Pass a stable company id so usage can be governed per company:

```ts
const result = await hive.services.invokeOperation(
  "leadgen-data",
  "leads.discover",
  {
    companyId: "company_acme",
    query: "independent dental practices in Austin, Texas",
    maxResults: 10,
    regionCode: "US",
  },
  { idempotencyKey: "acme-austin-dentists-001" },
);
```

The registered operations are `catalog.get`, `leads.discover`, `leads.nearby`, and `leads.enrich`. Restrict production keys to the operations they need, set per-operation request and concurrency limits, and retry uncertain requests with the original idempotency key. The service enforces its own per-call and daily safety ceilings and refunds work that fails before producing usable results.

### Web Data

`web-data` is a live managed service for facts a page read cannot give you, in 73 lookups: what Google, Bing, Yahoo, Google Maps and Google News show for a search; how often a keyword is searched, related keywords and their trend; a site's backlinks and authority; public TikTok, Instagram, LinkedIn, YouTube, Facebook, Threads, Douyin, Xiaohongshu, Bilibili and Weibo profiles, posts and comments; people and companies by description, a work email or phone number, a company's profile, news and open jobs; Amazon products; stock prices; research papers; and what Perplexity answers to a question. It needs no data-provider account. Every call uses the account's HivemindOS balance.

Read what is on offer first. `catalog.get` is free and lists every lookup with the fields it takes and the most it can cost:

```ts
const catalog = await hive.services.invokeOperation(
  "web-data",
  "catalog.get",
  undefined,
  { idempotencyKey: "web-data-catalog-2026-10-13" },
);
```

Then run one lookup by its id:

```ts
const result = await hive.services.invokeOperation(
  "web-data",
  "sites.backlinks",
  { site: "example.com" },
  { idempotencyKey: "example-backlinks-001" },
);
// { ok: true, operation: "sites.backlinks", found: true, result: { ... }, billing: { costUsd, refundUsd, ... } }
```

Each lookup holds its top price while it runs and settles at what it cost: the rest comes back at once, a lookup that fails is not charged, and one that finds nothing at no cost is free. A single lookup is at most $0.50, and an account is limited to $5 of lookups a day. `found: false` means the lookup ran and had no answer. Retry an uncertain call with the same idempotency key.

For anything the named lookups do not cover (the ads a company is running, reviews on Trustpilot or an app store, an online shop's products, and thousands more single-site lookups), search first, then run what you found by its id:

```ts
const found = await hive.services.invokeOperation(
  "web-data",
  "catalog.search",
  { query: "trustpilot reviews" },
  { idempotencyKey: "find-trustpilot-001" },
);
// result.lookups: [{ id, title, about, fields, aboutPriceUsd, maxPriceUsd }, ...]

const reviews = await hive.services.invokeOperation(
  "web-data",
  "catalog.call",
  { lookup: found.result.lookups[0].id, input: { domain: "www.notion.so", limit: 5 } },
  { idempotencyKey: "notion-trustpilot-001" },
);
```

`catalog.search` is free. `catalog.call` is charged like any other lookup: it holds a top price (a few times the lookup's usual price, or `maxPriceUsd` when you send one, never above $0.50), settles at what it cost and returns the rest. Its answer is in the site's own shape. Only lookups of public data that answer at once can be run this way.

### Other services

- AI web search: see [answer-engine](answer-engine.html).
- Hive Compute and testnet assets: see [compute and faucet](compute-faucet.html).
- Wallets, trading, and swaps: see [wallets and trading](wallets-trading.html).
- Databases: see [managed databases](databases.html).

## Stable service ids

Availability depends on the account and deployment. This table lists stable ids; `GET /services` gives live status.

| Category | Service id | Purpose |
|---|---|---|
| Agent | `hive-research` | Deep research with sourced results and reusable artifacts. |
| Agent | `answer-engine` | Ask the web a question and get an answer with cited sources. |
| Agent | `nft-agents` | Use a person's HivePunkz and other agent NFTs: list them, look any up, chat with theirs, and hire shared bees. |
| Agent | `swarm` | Coordinate multiple cloud agents around one outcome. |
| Agent | `distill` | Turn source material into reusable agent capabilities. |
| Agent | `managed-models` | Use HivemindOS-managed model inference. |
| Agent | `cloud-superbrain` | Use managed memory and knowledge services. |
| Agent | `managed-agents` | Create and operate persistent cloud agents. |
| Agent | `managed-workflows` | Run scheduled and event-driven cloud workflows. |
| App | `managed-bookings` | Create and operate booking flows. |
| Data | `reddit-voc` | Discover audience language, pain points, and opportunities. |
| Data | `hivemind-analytics` | Capture and query product analytics. |
| Data | `miroshark` | Run managed market-intelligence workflows. |
| Data | `leadgen-data` | Enrich and qualify business leads. |
| Data | `web-data` | Look up search rankings, backlinks, social profiles, people and companies. |
| Finance | `token-autopsy` | Analyze token structure, activity, and market risk. |
| Finance | `wallet-risk` | Assess wallet behavior and risk signals. |
| Finance | `copy-trading` | Run HivemindOS copy-trading logic and monitors. |
| Finance | `hive-bridge` | Quote buying $HIVE on Base with ETH or USDG from Robinhood Chain, or selling it back, and track the route. |
| Finance | `hivemind-finance` | Read connected financial accounts and delegate refresh or connection management with exact API-key permissions. |
| Finance | `testnet-faucet` | Discover supported testnet assets, request them, and track each claim with HivemindOS credits. |
| Finance | `managed-wallets` | Create policy-controlled wallets and execute approved actions. |
| Finance | `managed-trading` | Quote and execute policy-controlled spot trades. |
| Finance | `universal-swaps` | Swap any token into any other, on one chain or across chains, from a HivemindOS wallet or your own. Spend an amount or receive an exact amount, in fields or plain words. |
| Integration | `x-api` | Use managed X actions and account workflows. |
| Integration | `managed-socials` | Schedule and manage social publishing. |
| Integration | `outbound-email` | Send and manage outbound email workflows. |
| Integration | `integration-broker` | Connect calendars and remote tool servers while HivemindOS protects their credentials. |
| Media | `x-studio` | Create, review, and package social content workflows. |
| Media | `x-transcript` | Create transcripts and structured knowledge from X media. |
| Media | `media-studio` | Generate and manage production-ready media. |
| Media | `managed-media` | Generate media across the full hosted catalog with automatic exact-model fallback — image, video, audio, lip-sync, edit, upscale, and 3D. |
| Media | `photo-keyworder` | Analyze photos and create searchable metadata. |
| Platform | `app-hosting` | Publish static sites and managed dynamic apps. |
| Platform | `hive-compute` | Run managed inference, image generation, and confidential asynchronous workloads with HivemindOS credits. |
| Platform | `gpu-rentals` | Provision managed GPU workloads. |
| Platform | `hivemind-database` | Provision portable managed application data. |

## Related

- [Capabilities and approvals](capabilities-agents.html)
- [Per-endpoint limits](limits.html)
- [Runs and webhooks](runs-webhooks.html)
