# Bankr Deployment Models

Use this reference before deciding whether a Bankr integration is a skill, app, x402 endpoint, external service, or combination.

The Bankr facts below were confirmed against the official documentation on 2026-07-16. Re-read the linked pages before quoting them because platform policy can change.

## Bankr skill

A skill is a `SKILL.md` file with YAML frontmatter and an instruction body. A sibling `references/` folder can hold supporting material, and the format reference also permits a `scripts/` resource folder.

Bankr installs a skill per wallet. The agent uses it when the request matches the description. Installation from GitHub requires a public repo, directory, or direct skill-file URL. Installing the same name replaces the existing version.

Confirmed sources:

- [Skills overview](https://docs.bankr.bot/skills/overview/)
- [Install a skill from GitHub](https://docs.bankr.bot/skills/in-bankr/from-github/)
- [SKILL.md format](https://docs.bankr.bot/skills/in-bankr/skill-format/)

A skill is the right discovery/control layer for a capability such as copy trading. It can tell Bankr how to configure the service, call a hosted API, inspect status, or use the user's Bankr wallet. It does not by itself prove that an always-on process exists.

## Bankr x402 Cloud

x402 Cloud hosts paid HTTP handlers at a Bankr URL. Bankr handles request payment, service discovery, server-side bundling/sandboxing, endpoint logs, configuration, and revenue settlement. A caller can pay automatically from a Bankr wallet after the configured confirmation path.

Current runtime facts:

- Serverless and invocation-driven.
- 30-second execution limit and 256 MB memory limit.
- Outbound HTTP is allowed.
- `/tmp` is ephemeral.
- Optional `ctx.files` provides persistent files scoped to the service.
- Optional `ctx.appKV` shares state with a Bankr app.
- Optional `ctx.askAgent` can invoke the owner's Bankr agent.
- x402 environment variables are encrypted and are separate from regular agent environment variables.

Current pricing facts:

- No monthly fee, subscription, or minimum.
- First 1,000 settled requests per month: 0% platform fee.
- Pro after that: 5% platform fee and unlimited requests.
- Enterprise is documented as 3% with sales contact.
- Settlement is on Base in the configured token, USDC by default, and revenue goes to the configured wallet.

Confirmed sources:

- [x402 Cloud overview](https://docs.bankr.bot/x402-cloud/overview/)
- [x402 Cloud pricing](https://docs.bankr.bot/x402-cloud/pricing/)
- [x402 Cloud security and limits](https://docs.bankr.bot/x402-cloud/security/)
- [x402 Cloud CLI](https://docs.bankr.bot/x402-cloud/cli-reference/)

Use x402 when payment belongs to a request. Examples: research lookup, model invocation, generation job, API transformation, or a one-shot analysis. Do not represent x402 Cloud as a continuously awake monitor. A handler can call an external always-on service, but that service remains separately hosted and costed.

## Bankr app

A Bankr app provides a sandboxed UI plus server-side scripts. The app SDK supports persistent state, wallet-aware actions, explicit transaction confirmation, and visitor-paid x402 calls. Backend scripts may also run on supported app schedules.

Two wallet roles must stay distinct:

- The app owner owns the app and its configured services.
- A signed-in visitor can pay an x402 call from the visitor's wallet after confirmation.

Confirmed sources:

- [Apps overview](https://docs.bankr.bot/apps/overview/)
- [Apps SDK](https://docs.bankr.bot/apps/sdk/)

An app can be the complete home for simple scheduled or user-triggered workflows. Use an external backend when the workflow needs continuous chain polling, long-running state machines, independent chain RPC verification, server-authoritative commercial policy, or operational guarantees beyond the documented app schedule/runtime.

## Wallet API and Agent API

The Wallet API is synchronous and deterministic. Use `/wallet/me` and `/wallet/portfolio` for reads and `/wallet/swap-quote`, `/wallet/swap`, `/wallet/transfer`, `/wallet/sign`, or `/wallet/submit` for supported writes. Write endpoints require Wallet API access and a non-read-only key. Recipient allowlists apply differently by endpoint, so read the current access-control table instead of assuming one allowlist protects every write.

The Agent API is asynchronous. `POST /agent/prompt` returns `202 Accepted` with a job ID. Poll `GET /agent/job/{jobId}` until `completed`, `failed`, or `cancelled`. It is suitable for natural-language decisions and Bankr-hosted skill installation, not for synchronous completion assumptions.

Confirmed sources:

- [Wallet API overview](https://docs.bankr.bot/wallet-api/overview/)
- [Agent API overview](https://docs.bankr.bot/agent-api/overview/)
- [Agent job management](https://docs.bankr.bot/agent-api/job-management/)
- [Agent API access control](https://docs.bankr.bot/agent-api/access-control/)

## Always-on managed backend

Use a HivemindOS-controlled Worker, Durable Object, queue, database, or equivalent when the product needs:

- continuous wallet or chain monitoring;
- alarms and cursor persistence independent of a user's Bankr session;
- exact-once claims, replay protection, and ambiguous-submission pauses;
- encrypted long-lived wallet credentials;
- independent RPC verification after Bankr returns a transaction hash;
- authoritative price, fee recipient, entitlements, quotas, and audit receipts.

Bankr may still host the user wallet, signing, direct swap/transfer APIs, skill, app, and optional x402 request layer. Those Bankr-hosted pieces do not eliminate the external backend's hosting cost.

## Architecture decision rule

Use this order:

1. If the capability is instructions only, ship a Bankr skill.
2. If the user needs a Bankr-native UI, add a Bankr app.
3. If each invocation should charge the caller, add an x402 endpoint.
4. If the system must act while no request or app session exists, add an always-on backend or use a specifically documented schedule that meets the requirement.
5. If a wallet action is exact, use Wallet API. If the desired action requires Bankr's reasoning, use Agent API and poll it.

For copy trading, the complete pattern learned in production was:

```text
Bankr skill/app -> HivemindOS hosted monitor -> Bankr Wallet API -> independent Base verification
                                              -> direct verified per-trade fee
```

There is no need for a separate app funding wallet when Bankr already owns the user's execution wallet. The user funds that Bankr wallet. A per-success fee can be transferred directly from it only after the copied trade is independently verified and the user has explicitly accepted the current server-published fee policy.

## Cost worksheet

Do not answer "cost per user" from the Bankr hosting line alone. Calculate:

```text
monthly service cost per active user
= always-on backend compute and storage allocation
+ chain/RPC/data-provider usage
+ LLM or agent usage
+ support/monitoring allocation
+ Bankr x402 platform fee, if the service uses settled x402 requests above the free tier
+ any gas not sponsored by Bankr
- service fees or other revenue attributable to that user
```

Separate confirmed costs from estimates. Bankr's x402 pricing is confirmed by its live documentation. A Cloudflare Worker/Durable Object amount is an estimate until measured from deployed usage. Transaction volume, polling frequency, provider calls, and trade failure rate usually drive the per-user variance.
