---
name: bankr-skill-deployment
description: Design, package, publish, install, update, verify, or troubleshoot a skill, app, wallet integration, or paid x402 endpoint that runs with Bankr, including HivemindOS packaged-skill and Shared Brain delivery.
tags: [bankr, skills, x402, deployment, wallet-api, agent-api, hivemindos]
version: 1
visibility: public
metadata:
  clawdbot:
    emoji: "🏦"
    homepage: "https://github.com/LiamVisionary/hivemindos/tree/main/packaged-skills/auto-install/bankr-skill-deployment"
    requires:
      bins: [git, node]
---

# Deploy Bankr Skills

Use this skill when a user wants to make a capability available inside Bankr, publish a paid API through Bankr, connect a Bankr wallet to an external service, or verify that one of those deployments actually works.

Do not begin by treating "Bankr skill," "Bankr app," "x402 endpoint," and "always-on backend" as interchangeable. Choose the execution surface first.

## Choose the execution surface

| Surface | What Bankr provides | Use it for | Do not assume |
| --- | --- | --- | --- |
| Bankr skill | Per-wallet agent instructions plus installed resources | Teaching Bankr a workflow, calling Bankr tools, or integrating an external API | Installing a skill does not create a continuously running daemon |
| Bankr x402 Cloud | A paid, request-driven HTTP handler with settlement, discovery, logs, encrypted endpoint env, and bounded persistence | APIs that should charge the caller's Bankr wallet for each request | A request handler is not an always-on poller; current limits are 30 seconds and 256 MB |
| Bankr app | A Bankr-hosted UI with backend scripts, persistent app state, wallet-aware actions, and supported schedules | Guided dashboards and user-triggered or simple scheduled Bankr workflows | The app owner and signed-in visitor can have different wallets and payment roles |
| Bankr Wallet API | Synchronous wallet reads and direct writes | Deterministic balances, quotes, swaps, transfers, signing, and submission | A 2xx response alone is not independent onchain verification |
| Bankr Agent API | Asynchronous natural-language jobs | Asking the Bankr agent to install skills or decide how to act | `202 Accepted` means queued, not installed or completed |
| External hosted backend | Long-lived alarms, polling, server-owned policy, replay protection, durable secrets, and independent chain verification | Always-on monitoring, copy trading, authoritative fees, entitlements, and multi-step state machines | Bankr is not hosting this component merely because a Bankr skill calls it |

The common complete design is a Bankr skill for discovery and control, a Bankr wallet for execution, and an external hosted backend for always-on work. Add x402 Cloud when the product is a paid request-time API. Do not force x402 into a post-trade fee or subscription if the intended economics are a fee only after a successfully verified trade.

Read [references/deployment-models.md](references/deployment-models.md) before choosing architecture or quoting hosting costs.

## Required workflow

1. Read the current official Bankr documentation for the exact surfaces in scope. Bankr limits, fees, supported chains, SDK behavior, and CLI commands are time-sensitive.
2. Write down who owns the wallet, who signs or executes, who pays, who receives revenue, who hosts each component, and which service is authoritative for policy.
3. Build the smallest complete package: `SKILL.md`, focused references, deterministic helpers only when useful, and an eval manifest whose skill name and version match the frontmatter.
4. Keep every credential out of source, prompts, logs, screenshots, responses, and test fixtures. Declare names only and place values in the correct encrypted scope.
5. Run the local package verifier and focused tests before publishing.
6. Publish the skill to a public URL before asking Bankr to install it. A local directory or unpushed branch is not remotely installable.
7. Install or update it through Bankr, wait for the Agent API job to reach a terminal state, then inspect the installed name, version, and resources.
8. Test through the real Bankr entry path. For x402, inspect the schema, confirm an unpaid call returns `402`, then make the smallest authorized paid call and verify the result and settlement.
9. Record rollback: replace/reinstall the prior skill, pause/delete the x402 service, revoke the dedicated key, or disable the external backend without erasing immutable transaction receipts.

Follow [references/publish-install-verify.md](references/publish-install-verify.md) for the concrete package, HivemindOS sync, Bankr install, and x402 verification sequence.

## Non-negotiable boundaries

- Never reveal or request a raw Bankr API key in chat. Refer to names such as `BANKR_API_KEY`, `BANKR_LLM_KEY`, or a capability-specific variable only.
- HivemindOS Shared Hive Env, regular Bankr agent Env Vars, and Bankr x402 Env Vars are separate stores. A value existing in one does not prove it exists in another.
- Use a dedicated, minimally funded Bankr account/key for automation. Enable only the required Wallet or Agent API capability, use read-only mode for reads, and apply IP/recipient restrictions where the chosen endpoint can enforce them.
- Existing Bankr users should connect their existing Bankr wallet through a restricted key. Do not invent a recovery-phrase export flow for an embedded wallet or claim partner wallet provisioning exists without a confirmed partner credential and contract.
- If exact wallet operations are known, prefer the synchronous Wallet API. Use the Agent API when Bankr's reasoning is intentionally part of the product.
- Poll Agent API jobs until `completed`, `failed`, or `cancelled`. Never report success from a queued or processing job.
- Keep official price, fee recipient, entitlement, and revenue policy server-side. Treat the client, local env, and caller JSON as untrusted.
- Before charging a fee after a transaction, independently verify the expected sender, recipient, token, amount, chain, success status, and idempotency key. Pause instead of retrying an ambiguous submission.
- An observed event, an accepted wallet request, a successful onchain transaction, a collected fee, and profitability are different claims.
- Apply company spend restrictions only when the action carries a validated active company-task context. Ordinary user-level Bankr wallet activity must not inherit company policy just because the agent also belongs to a company.
- Never promise profitability. Deployment correctness and transaction success do not establish positive expected returns.

Read [references/security-commercial-boundaries.md](references/security-commercial-boundaries.md) before any wallet write, secret transfer, paid endpoint, or HivemindOS commercial integration.

## Local package check

From the HivemindOS repository root:

```bash
node packaged-skills/auto-install/bankr-skill-deployment/scripts/verify-bankr-skill.mjs \
  packaged-skills/auto-install/<skill-slug>
```

After the skill is public, also compare the deployed GitHub `SKILL.md`:

```bash
node packaged-skills/auto-install/bankr-skill-deployment/scripts/verify-bankr-skill.mjs \
  packaged-skills/auto-install/<skill-slug> \
  --remote-url https://github.com/<owner>/<repo>/tree/main/<path-to-skill>
```

This catches the version mismatch that matters most in practice: the local `SKILL.md`, eval manifest, public GitHub copy, and Bankr-installed copy must all describe the same version.
