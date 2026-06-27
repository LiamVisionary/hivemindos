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
| Local TTS Agent Calls        |      Yes |   No | One selected agent speaks through a validated local or Tailnet TTS runtime while HivemindOS still routes work through the same agent runtime. |
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
- Persist a voice run timeline with call state, user transcripts, agent captions, tool calls, runtime-turn results, post-call extraction, and QA.
- Expose provider capability, recipe, and tool-bundle metadata so agents can choose a call implementation from intent instead of hard-coded provider names.

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

## Voice Runs

Every dashboard, mobile, Local TTS, and LiveKit-backed agent call creates a voice run under the local HivemindOS store. A run is the reviewable call record: initial context, selected agent and machine, provider, recipe id, tool bundle id, timeline events, gathered context, summary, and QA.

The timeline records:

- call creation, connection, and end events
- user transcripts
- agent captions
- tool-call starts and completions
- runtime-turn starts, completions, and failures
- post-call extraction and QA completion

This makes calling debuggable in the same way normal agent runs are debuggable. A voice call can now answer “what happened?”, “which tool failed?”, “what did the user ask last?”, and “does this need follow-up?” without relying on browser-only state.

Voice runs intentionally redact obvious secrets and raw IP-like values before writing to disk.

## Recipes And Tools

Calling now has explicit voice recipes and tool bundles. The default recipe is `agent-runtime-bridge`, which gives the voice layer one side-effecting tool: `ask_computer_agent`. That tool delegates the spoken request to the selected computer-side agent runtime.

The same registry also describes future coordinator-style voice sessions, such as a Queen Bee control-plane recipe with task creation, preference capture, dashboard driving, and agent delegation. Recipes are data, not scattered branches, so new call modes can be discovered and validated before a UI exposes them.

## Provider Capabilities

Voice configuration exposes capability records for the available implementations:

- `openai-realtime`: direct BYOK WebRTC call with tool calls and transcripts.
- `local-tts`: local or Tailnet TTS bridge with realtime STT and runtime delegation.
- `livekit-cloud-room`: managed room transport for multi-party and multi-agent calls.
- `native-callkit`: mobile/native call presentation capability for device-hosted flows.

Each capability record includes transport type, transcript/recording/multi-party support, required credential key names, side-effect gates, status, and fallback provider ids. Agent-facing capability search should use this evidence first, then choose the configured provider that satisfies the user's intent.

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
| Local or Tailnet TTS voice bridge                             |              Yes |                                               No |
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
| Voice run timeline, extraction, and QA                         |              Yes |                                              Yes |
| Hosted reliability and room management                        |               No |                                              Yes |
| Premium paid service                                          |               No |                                              Yes |

## Setup Notes

BYOK Agent Calls need one of these keys in HivemindOS:

```text
OPENAI_REALTIME_KEY
OPENAI_API_KEY
```

HivemindOS Cloud Agent Calls are opt-in. LiveKit rooms connect over the internet, so the cloud path stays fully off in the local-first default even when LiveKit credentials are present. Enabling it requires the premium entitlement plus an explicit LiveKit opt-in, alongside the managed room credentials:

```text
HIVEMINDOS_PREMIUM=1
HIVEMINDOS_LIVEKIT_ENABLED=1
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
```

In local dev, `pnpm tauri:dev` starts the HivemindOS voice worker only when both opt-in flags and the LiveKit credentials are present. Otherwise the worker skips itself with a single notice line, no LiveKit connection is made, and the normal BYOK and Local TTS paths still work.

## Inspection API

The phone API exposes these local inspection and control actions:

- `GET /api/phone?action=voice-capabilities`
- `GET /api/phone?action=voice-recipes`
- `GET /api/phone?action=voice-runs`
- `GET /api/phone?action=voice-run&id=<run-id>`
- `POST /api/phone` with `action: "voice-run-event"`
- `POST /api/phone` with `action: "voice-run-complete"`
- `POST /api/phone` with `action: "voice-run-qa"`
- `POST /api/phone` with `action: "voice-recipe-validate"`

## Main Code Paths

- `src/app/api/phone/route.ts`
- `src/lib/services/phone/call-gateway.ts`
- `src/lib/services/phone/realtime-voice.ts`
- `src/lib/services/phone/voice-provider-capabilities.ts`
- `src/lib/services/phone/voice-recipes.ts`
- `src/lib/services/phone/voice-run-route-actions.ts`
- `src/lib/services/phone/voice-runs.ts`
- `src/lib/services/phone/voice-tool-bundles.ts`
- `src/components/fleet/agent-call-modal.tsx`
- `src/components/fleet/agent-call-run-events.ts`
- `src/features/dashboard/views/AgentsPanel.tsx`
- `src/features/dashboard/views/PhonePanel.tsx`
- `src/features/dashboard/views/chat/AgentCallsSettingsPanel.tsx`
- `scripts/hivemindos-call-agent-worker.mjs`
- `scripts/e2e-dashboard-agent-call.mjs`
