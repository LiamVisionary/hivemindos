---
title: Calling
description: HivemindOS agent calling, mobile pairing, BYOK calls, and paid cloud rooms.
---

# Calling

Calling is the part of HivemindOS where the agents stop feeling trapped behind a text box.

The basic version is simple: open HivemindOS, pick an agent, call it, talk out loud, and let the call bridge your voice into the same computer-side runtime that already knows the agent, machine, repo, memory, tools, and work context.

The default is still local-first and bring-your-own-key. The paid cloud path exists for the stuff that needs a real room: mobile-to-agent calls that survive app boundaries, multi-party rooms, and the “me, my friend, and a few agents all talking together” version of this.

## The Split

| Call mode                    | Included | Paid | Best for                                                                                                                                  |
| ---------------------------- | -------: | ---: | ----------------------------------------------------------------------------------------------------------------------------------------- |
| BYOK Agent Calls             |      Yes |   No | One person talking to one selected HivemindOS agent from the desktop dashboard or paired mobile app using the user's OpenAI Realtime key. |
| HivemindOS Cloud Agent Calls | Optional |  Yes | Managed LiveKit/SFU rooms, mobile-friendly rooms, group calls, and multi-agent voice sessions.                                            |

The default mode is **BYOK Agent Calls**. That is the “download the app, add your key, talk to your agent” path.

HivemindOS Cloud Agent Calls are the premium path. They use the managed LiveKit branch for calls that need a room instead of a direct one-to-one browser Realtime connection.

## What Calling Can Do

Free BYOK features:

- Call an agent directly from the HivemindOS dashboard.
- Pair the mobile app to the HivemindOS gateway.
- Let the mobile app list available HivemindOS agent targets.
- Start one-to-one agent calls using the user's own OpenAI Realtime key.
- Route spoken requests into the selected computer-side agent through `ask_computer_agent`.
- Keep the agent attached to its runtime, machine, repo, vault context, skills, memory, and recent work context.
- Use the dashboard microphone and speaker path inside the Tauri desktop app.
- Fall back to speaker-only mode when microphone capture is unavailable, so the agent can still talk instead of silently failing.
- Show live call state in the dashboard call modal.
- Keep agent captions scoped to the latest spoken response instead of gluing every reply together.

Paid HivemindOS Cloud features:

- Managed LiveKit rooms for voice calls.
- SFU-backed audio routing for more than one participant.
- Mobile-to-agent rooms that do not depend on the private mobile backend running beside the desktop app.
- Room tokens for dashboard and mobile participants.
- LiveKit agent dispatch, so the HivemindOS voice worker joins the room as the agent speaker.
- Multi-party rooms where humans and multiple AI agents can participate in the same conversation.
- A path to managed reliability, room orchestration, and hosted voice infrastructure.

## How BYOK Agent Calls Work

BYOK Agent Calls use OpenAI Realtime directly.

The HivemindOS hub creates a short-lived Realtime client secret with the user's configured key. The dashboard or mobile app uses that client secret to open the audio call. The selected computer agent is not replaced by a generic voice bot; the voice layer gets a tool called `ask_computer_agent`, and that tool sends the spoken request back through the HivemindOS runtime bridge.

That matters because the agent still has its normal context:

- which agent was selected
- which machine owns it
- which runtime it uses
- which repo or workspace it is tied to
- which skills and memory are available
- which recent work or MiroShark artifacts are relevant
- which vault context can be safely summarized

The voice layer is the mouth and ears. The HivemindOS agent is still the worker.

## How Mobile Fits In

The mobile app connects to the HivemindOS gateway. After pairing, it can ask the hub for call-capable agents and start the same default BYOK call mode.

The user flow should feel like this:

1. Install and open HivemindOS.
2. Add the user's OpenAI key for BYOK Agent Calls.
3. Install the mobile app and connect it to the HivemindOS gateway.
4. Pick an agent.
5. Call it.

That is the free baseline. No separate private mobile repo should be required at runtime for the HivemindOS desktop app to expose its calling surface.

## How HivemindOS Cloud Agent Calls Work

The cloud path uses LiveKit rooms.

Instead of making a direct one-to-one browser Realtime call, HivemindOS creates a room, mints participant tokens, and dispatches the HivemindOS call agent worker into that room. LiveKit acts as the SFU, which means it routes audio streams between the participants without forcing every participant to build a direct connection to every other participant.

That room model unlocks the paid stuff:

- one human talking to one agent from mobile
- one human moving between desktop and phone
- two humans talking with one agent
- several humans and several agents in the same room
- future call products where the room itself is the feature

Cloud calls still use the same computer-agent bridge. When a user asks the agent to inspect, change, run, schedule, or answer from its runtime context, the voice worker delegates through the HivemindOS hub.

## Feature Matrix

| Feature                                                       | BYOK Agent Calls |                     HivemindOS Cloud Agent Calls |
| ------------------------------------------------------------- | ---------------: | -----------------------------------------------: |
| Direct dashboard agent calls                                  |              Yes |                                              Yes |
| Paired mobile app can call agents                             |              Yes |                                              Yes |
| Uses the user's OpenAI Realtime key                           |              Yes |                                         Optional |
| Short-lived Realtime client secrets                           |              Yes | Yes, when OpenAI Realtime powers the agent voice |
| Routes spoken requests to the selected computer agent         |              Yes |                                              Yes |
| Agent keeps runtime, machine, repo, skill, and memory context |              Yes |                                              Yes |
| Local-first default                                           |              Yes |                                               No |
| Requires HivemindOS-managed voice infrastructure              |               No |                                              Yes |
| LiveKit room orchestration                                    |               No |                                              Yes |
| SFU audio routing                                             |               No |                                              Yes |
| Multi-human rooms                                             |               No |                                              Yes |
| Multi-agent rooms                                             |               No |                                              Yes |
| Hosted reliability and room management                        |               No |                                              Yes |
| Premium paid service                                          |               No |                                              Yes |

## Setup Notes

BYOK Agent Calls need one of these keys in HivemindOS:

```text
OPENAI_REALTIME_KEY
OPENAI_API_KEY
```

HivemindOS Cloud Agent Calls use the LiveKit branch and need managed room credentials on the service side:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
```

In local dev, `pnpm tauri:dev` starts the HivemindOS voice worker when the LiveKit credentials are present. If they are missing, the worker skips itself and the normal BYOK path still works.

## Main Code Paths

- `src/app/api/phone/route.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/lib/services/phone/realtime-voice.ts`
- `src/components/fleet/agent-call-modal.tsx`
- `src/features/dashboard/views/AgentsPanel.tsx`
- `src/features/dashboard/views/PhonePanel.tsx`
- `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx`
- `scripts/hivemindos-call-agent-worker.mjs`
- `scripts/e2e-dashboard-agent-call.mjs`
