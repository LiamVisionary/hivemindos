---
title: HivemindOS Cloud Agent Calls
description: Paid LiveKit/SFU calling for managed multi-party and multi-agent voice rooms.
---

# HivemindOS Cloud Agent Calls

HivemindOS Cloud Agent Calls are the paid version of agent voice.

The free call path is BYOK: one user, one selected agent, the user's OpenAI Realtime key, and a direct dashboard or mobile call. That is enough for the normal “I want to talk to my coding agent” loop.

Cloud Agent Calls are for the version that needs an actual room.

## What Makes It Paid

LiveKit/SFU calls require managed voice infrastructure.

HivemindOS has to create rooms, mint participant tokens, dispatch the voice worker, keep the call agent alive, route audio between participants, and pay attention to reliability. That is not just a local UI feature. It is an operated service.

So the rule is clean:

| Capability                               | BYOK Agent Calls | HivemindOS Cloud Agent Calls |
| ---------------------------------------- | ---------------: | ---------------------------: |
| One user calls one selected agent        |         Included |                     Included |
| Uses user's OpenAI Realtime key directly |              Yes |                     Optional |
| Managed LiveKit rooms                    |               No |                          Yes |
| SFU audio routing                        |               No |                          Yes |
| Mobile-friendly room tokens              |               No |                          Yes |
| Multiple humans in one call              |               No |                          Yes |
| Multiple agents in one call              |               No |                          Yes |
| Hosted room reliability                  |               No |                          Yes |
| Premium paid service                     |               No |                          Yes |

## What The LiveKit Branch Does

The LiveKit branch gives HivemindOS a room model.

The hub creates a LiveKit room, creates participant tokens for the dashboard or mobile app, and dispatches the HivemindOS call agent worker into the room. The worker uses OpenAI Realtime for the voice model and exposes the `ask_computer_agent` tool so the room can still reach the selected computer-side runtime.

In code, that path is the cloud mode:

- `createInAppCall` creates the LiveKit room and participant tokens.
- `AgentDispatchClient` dispatches the HivemindOS call agent worker.
- `scripts/hivemindos-call-agent-worker.mjs` joins the room and speaks.
- `ask_computer_agent` sends work back to `/api/phone`.
- `/api/phone` routes that request into `/api/chat/agent-runtime`.

The result is still an agent call, not a detached voice assistant.

## Why SFU Matters

SFU means selective forwarding unit.

In plain English: it is the room switchboard. Each participant sends audio to the server, and the server forwards the right audio streams to the other participants.

That matters once the call is bigger than one person and one agent. Without an SFU, every participant has to maintain direct media connections to every other participant. That gets messy fast. With an SFU, the room can handle:

- one user on mobile and one agent
- one user on desktop, one user on mobile, and one agent
- a friend joining the room
- a few different agents in the same conversation
- future moderation, recording, routing, and room lifecycle controls

## Product Promise

The promise is not “pay to talk to your agent.”

The promise is: pay when HivemindOS runs the room for you.

Free BYOK Agent Calls should stay the default. HivemindOS Cloud Agent Calls are for the room-shaped version of the product: shared calls, mobile-friendly rooms, multi-agent conversations, and managed reliability.

## Required Service Configuration

Cloud calls require LiveKit credentials on the managed service side:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
```

The HivemindOS call agent worker also needs an OpenAI Realtime key:

```text
OPENAI_REALTIME_KEY
OPENAI_API_KEY
```

In local development, `pnpm tauri:dev` starts the worker when the required environment is present. In packaged or hosted premium service form, those credentials belong to the managed HivemindOS Cloud service, not to the user's normal local setup.

## Main Code Paths

- `src/lib/services/phone/realtime-voice.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/app/api/phone/route.ts`
- `scripts/hivemindos-call-agent-worker.mjs`
- `scripts/tauri-next-dev.mjs`
