---
title: Hive Compute Marketplace
description: First-party marketplace inference, spare-GPU supply, payment rails, and HivemindOS platform revenue.
---

# Hive Compute Marketplace

Hive Compute is the first-party compute marketplace for HivemindOS.

Users get cheaper model inference when live marketplace capacity is available.
Hosts can earn from spare local GPUs or model servers. HivemindOS runs the
trusted marketplace layer: matching, balances, receipts, settlement, reputation,
policy, and payout state.

HivemindOS owns the product demand surface, the host onboarding path, and the
hosted settlement gateway.

The marketplace is public by design: buyers discover listings and call the
hosted gateway over the public internet, while host machines keep their model
servers private and connect outbound through the worker. That makes supply easy
to bring online without turning a host's laptop or workstation into a raw
public machine-rental surface.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="./">Previous: Paid Features</a>
  <a href="../ecosystem-plan.html">Review: Ecosystem Plan</a>
</nav>

## Current Default Economics

The current hosted gateway policy is token metered.

| Item | Current default |
| --- | ---: |
| Provider input price | `$0.016` per 1M input tokens |
| Provider output price | `$0.024` per 1M output tokens |
| Centralized fallback ceiling | `$0.020` per 1M input tokens, `$0.030` per 1M output tokens |
| HivemindOS platform fee | **20% of retail marketplace usage** |
| Provider share | Retail marketplace usage minus the platform fee |

The centralized ceiling matters because the marketplace should not route to a
worker that costs more than the managed fallback. If no eligible worker is live
at or below the ceiling, the route can fall back to managed HivemindOS models or
fail closed, depending on the requested mode.

Example marketplace economics at the current default provider price:

| Usage | Buyer retail debit | Provider earning | HivemindOS gross platform revenue |
| --- | ---: | ---: | ---: |
| 1M input + 1M output tokens | `$0.040` | `$0.032` | `$0.008` |
| 100M input + 100M output tokens | `$4.00` | `$3.20` | `$0.80` |
| 1B input + 1B output tokens | `$40.00` | `$32.00` | `$8.00` |

Gross platform revenue is before ordinary infrastructure, payment processing,
fraud controls, support, and payout operations.

## Revenue Shape

Hive Compute creates a two-sided revenue path:

- Buyer demand comes from HivemindOS model routes such as Auto, Fast, Deep, and
  live marketplace models in the normal agent/model picker.
- Host supply comes from users who press **Set up hosting** and **Go live** on a
  machine with Ollama, LM Studio, or another OpenAI-compatible local model
  server.
- Hosts can choose which discovered local models are advertised to the
  marketplace and can raise concurrency above the default one slot when their
  machine has enough headroom to serve multiple paid jobs at once.
- The gateway measures each worker/model route after real jobs complete:
  tokens per second, time to first token, and completion latency. Marketplace
  listings can then show speed bands without trusting host self-reporting.
- The hosted gateway reserves balance before the job, settles exact token usage
  after the job, writes the provider earning, and keeps the platform fee.
- x402 handles per-call machine payments. MPP sessions handle sustained
  machine-speed inference when the gateway publishes a compatible policy.

That creates revenue every time HivemindOS successfully routes paid marketplace
usage through first-party settlement.

## Marketplace Advantage

Hive Compute is strong because HivemindOS owns more of the loop:

- the agent/model demand surface
- the host onboarding flow
- model-level host supply controls and multi-slot capacity advertising
- measured speed/reliability metadata for better routing and marketplace trust
- worker listings and reputation
- provider bonds and failure quarantine
- TEE eligibility policy for private workloads
- MPP and x402 payment sessions
- platform-fee policy
- provider earnings and payout state

Basically, Hive Compute turns HivemindOS into the marketplace instead of only a
client for someone else's capacity.

## Trust Boundary

The downloadable app is not the commercial authority.

Official marketplace value has to be enforced by HivemindOS-controlled hosted
infrastructure or a verifiable settlement rail. The local app can install a
worker, display status, request a route, and show receipts, but it cannot be the
source of truth for official balances, platform fees, provider earnings,
withdrawals, entitlements, or payout policy.

The hosted gateway owns:

- prepaid balance crediting and reservation
- exact settlement after token usage
- x402 and MPP payment verification
- platform-fee calculation
- provider earnings
- provider withdrawals
- fraud events, canaries, quarantine, and reputation
- TEE verified-only routing policy and output-encryption policy

This keeps the open-source app useful for self-hosters while keeping official
revenue and payout logic in infrastructure HivemindOS controls.

## Privacy And Premium Compute

TEE support is a premium trust feature, not a local checkbox.

The gateway must verify attestation evidence, bind the worker to an expected
provider/model/code policy, and route encrypted prompts only to workers that can
decrypt inside the attested runtime. Hardware-only routing should fail closed
when no gateway-verified hardware TEE worker is online; local or dev
attestation is useful for testing but is not a hardware privacy claim.

Prompt encryption and output privacy are separate product promises. Verified
TEE routing encrypts the prompt payload from the gateway to the worker.
Gateway-blind output is the higher-trust premium tier: clients provide a public
key, workers return encrypted token/final-output envelopes, and the gateway
continues to meter usage, sign receipts, and settle revenue from token counts
without reading the answer. The standard response path remains plaintext at the
gateway for OpenAI-compatible streaming clients.

This creates a clean packaging distinction. Standard marketplace inference is
optimized for broad OpenAI-compatible adoption. Verified private routing adds
encrypted prompt delivery and worker eligibility policy. Hardware-private
routing requires gateway-verified hardware attestation and fails closed when
only dev/local evidence is present. Output E2E encryption is the gateway-blind
response tier for customers who can manage client-side keys and decryption.

That gives Hive Compute a clean premium story:

- normal marketplace routing for lower-cost inference
- verified private routing for sensitive workloads, with output E2E encryption
  as a premium trust tier
- MPP sessions for high-frequency agent usage
- hosted settlement and receipts for real revenue

## Product Line

Hive Compute should sit beside Cloud Agent Calls as a concrete paid feature:

| Product | What HivemindOS operates | Revenue model |
| --- | --- | --- |
| Cloud Agent Calls | Managed LiveKit/SFU rooms and call workers | Hosted call pricing |
| Hive Compute Marketplace | Matching, settlement, receipts, worker reputation, and payout state | Token-metered platform fee |

The free product remains local-first. Hive Compute becomes paid when HivemindOS
is operating the marketplace and settlement layer on the user's behalf.

<nav class="nextNav" aria-label="Monetization reading path">
  <a href="./">Back to paid features</a>
  <a href="../">Back to monetization</a>
</nav>
