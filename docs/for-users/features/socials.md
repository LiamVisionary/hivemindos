---
title: "Socials"
---

# Socials

Socials is the governed publishing desk for connected X, Telegram, Farcaster, LinkedIn, and Reddit accounts. Facebook can also be connected for browser-session workflows, but personal-feed and Marketplace publishing are not exposed as dashboard posts.

Each account has its own posting voice, awake hours, context sources, queue, history, and analytics. Text posts can be drafted, edited, scheduled, sent immediately, canceled, retried when safe, and reviewed after publishing. Platform-specific controls appear only where the connected API supports them, including Reddit titles and subreddits, Telegram message replies, Farcaster replies and quotes, and the limited reply and quote behavior available through X.

## Agent Drafting

Posting-capable accounts start with agent drafting enabled. Standalone generation waits until the account has at least one usable website, GitHub repository, local file, or local folder as factual context; a selected posting voice controls style but is not treated as proof that the account owns another brand's work. The drafting card shows **Add context first** without spending a model turn or scheduling a failed retry. X-account references remain identity and Comment Finder cues rather than silently importing post history. Once factual context is added, the default cadence creates three standalone drafts once per day, with controls for one to five drafts every six hours, twelve hours, one day, two days, or one week. **Generate full pack** creates the standalone posts plus any enabled comment suggestions immediately. The card shows the last successful pack, next scheduled pack, active generation, and any model or connection failure with its retry time.

The drafting agent reads the account's selected voice, configured context sources, and recent local queue history. Public webpages are downloaded with size, timeout, redirect, and private-network protections. Local sources are bounded to supported text files and obvious credential files are excluded. Source content is treated as untrusted reference material, never as agent instructions. An X-account context source is used as an identity cue without silently spending metered X reads.

Generated items carry their model, creation time, source references, and a private rationale so reviewers can understand the angle. Exact repeats already present in queue history are dropped. If every candidate in a pack fails the grounding, repetition, length, or human-voice checks, the model gets one bounded repair attempt using the exact rejection summary. A second failure reports those reasons and leaves the existing queue unchanged. If another pack would take the account past twenty pending generated items, background generation waits instead of filling the queue indefinitely.

## Comment Finder For X

X accounts also start with **Comment finder** enabled. The default full pack adds three reply suggestions based on public posts from the past two days. Standalone quote posts are an optional, separate suggestion type that is off by default because they publish on your profile with the source attached; they are not replies or comments. You can independently pause standalone posts or comment discovery, choose zero to five replies, optionally choose zero to two standalone quote posts, and set freshness from twelve hours to one week. Both producers follow the account's drafting cadence. **Find replies now** runs only the comment-discovery portion immediately.

Each connected X account has its own **Agent Reach X session** card. For multiple accounts, choose **Per-account credentials** and save or select that account's `auth_token` and `ct0` cookie values under unique Shared Hive Env names. The Socials definition stores only those variable names; cookie values remain in Shared Hive Env. Each discovery or delivery subprocess maps only the selected account's pair into Agent Reach, so two accounts can scan or publish concurrently without switching a machine-wide login. Existing single-account setups remain on **Machine default** until changed.

Comment finder reads through the selected account's local X session. Discovery does not spend managed-X read credits. Reviewed replies and optional quote posts are delivered through that same session so X receives the real reply or quote relationship; HivemindOS checks that the resolved Agent Reach identity matches the connected Socials account and fails closed on a mismatch. It checks the X accounts named in the account context and selected posting voice, asks the drafting model for bounded topic searches, filters the account's own posts, reposts, stale results, and any target already used in queue history, then ranks the remaining conversations. If the account's credential pair is missing, unavailable, or belongs to another handle, the card names the setup problem and does not pretend a scan ran.

Every reply or quote suggestion keeps an exact snapshot of the source post, its author, public metrics, discovery path, and a direct **Open target** link. The queue shows the source beside the proposed text so the reviewer can evaluate the response in context. Editing the draft cannot silently retarget it. Replies and quotes always remain review-only—even when standalone posts are in auto mode—and each **Send now** action names the target and asks for human confirmation. Discovery never likes, reposts, replies, quotes, or publishes by itself.

## Connect An Account

Open **Socials**, choose **Connect account**, and select a platform and connection method. HivemindOS supports managed X sign-in, bring-your-own X credentials, Telegram bots, Neynar-backed Farcaster signers, LinkedIn OAuth, Reddit script applications, and managed Facebook browser profiles.

Connection records contain account metadata and non-secret bindings only. Credentials stay in the shared environment or, for managed services, behind HivemindOS-controlled infrastructure. X MCP connections remain an agent-side rail and do not appear as if they can publish through the dashboard queue.

## Draft, Schedule, And Publish

The composer saves a draft without approving it. **Send now** asks for confirmation, records a durable human approval, and asks the queue engine to publish it. **Schedule** stores the requested local date and time; the engine publishes only after the scheduled time and inside the account's awake-hours window.

The queue is durable across dashboard reloads and app restarts. It runs automatically in both source development and packaged desktop builds. **Pause** stops drafting and scheduled delivery without deleting anything, while **Process queue** performs an immediate readiness pass. Drafting has its own enable/pause control when you want delivery to continue without producing new suggestions.

Published, failed, and canceled items move to **History**. A published item links to the provider when a stable URL is available. **Analytics** combines queue outcomes with the engagement and account metrics the provider exposes. Managed X accounts also have a structured daily read-budget control; HivemindOS reserves the expected operations atomically before a refresh so simultaneous clicks cannot overspend that local guard.

## Manual And Auto Modes

Accounts start in manual mode. Agent-created content enters the queue as a suggestion and cannot publish until a person approves or schedules it.

Auto mode is a separate per-account opt-in. It allows a confirmed automation policy to schedule content, but every automated item keeps a visible five-minute cancellation window and still obeys awake hours. Turning auto mode off immediately moves pending automated posts back to review. Ordinary agent tool calls continue to create review-only suggestions even while the account is in auto mode.

Agent drafting follows the same account policy for standalone posts. In manual mode, every generated draft waits for review. If you explicitly opt the account into auto mode, future standalone posts enter the visible cancellation window and may publish after it closes. Generated replies and quotes always wait for per-item human review. Pausing either producer does not change the posting policy for items already in the queue.

## Delivery Safety

The engine rechecks the connected account, approval record, current posting mode, schedule, cancellation window, and awake hours immediately before delivery. It claims one item at a time and records the attempt before contacting the provider.

Definite temporary failures use bounded backoff. If a network interruption happens after delivery begins, HivemindOS marks the result **Delivery unknown** and does not send it again automatically. Retry is available only after a person confirms they checked the social account and the post is not already live. This prevents a process restart from quietly duplicating a public post.

## Platform Boundaries

- X managed analytics reads and publishing use hosted HivemindOS credits and server-owned commercial policy. Bring-your-own X credentials call the X API directly from the local server. Comment discovery uses the separate local Agent Reach session and does not debit managed-X read credits. X may still reject replies or quotes to accounts that did not mention you at the connected app's current access level; the queue reports that provider failure instead of claiming success.
- Telegram exposes member counts, but its Bot API does not provide per-message view analytics.
- Farcaster publishing uses a configured Neynar signer and supports provider-native idempotency.
- LinkedIn text publishing requires the connected developer application to have `w_member_social` approval. Metrics are limited to the owner's posts.
- Reddit publishing supports self posts and comment replies; each community's own rules and rate limits still apply.
- The current queue is text-first. Platform-native image and video upload flows are not presented as supported; attempted media delivery fails with an actionable message instead of dropping attachments.

Managed-service entitlement, credit, pricing, and settlement decisions are enforced by HivemindOS-controlled infrastructure. The local app displays and submits those decisions but is not their commercial authority.
