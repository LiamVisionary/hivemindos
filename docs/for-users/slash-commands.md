---
title: Slash Commands
description: Dashboard, Hermes, gateway, and runtime slash command reference.
---

# Slash Commands

HivemindOS chat surfaces support two command families:

- Dashboard shortcuts handled by the HivemindOS UI.
- Hermes and gateway commands handled by the connected runtime.

Some commands are CLI-only or gateway-only. In the dashboard, unavailable commands may still appear as runtime help when the connected agent exposes them.

When a dashboard command and runtime command share the same name, the dashboard command handles it first in the HivemindOS chat surface. Use the runtime's native CLI/TUI when you need the runtime-specific behavior for a colliding command such as `/sessions` or `/usage`.

## Dashboard Commands

| Command | Aliases | Purpose |
| --- | --- | --- |
| `/doctor` | `/diagnostics` | Open fleet diagnostics and run checks. |
| `/sessions` | `/history` | Search recent runtime sessions. |
| `/fleet` |  | Open the fleet dashboard. |
| `/models` | `/providers` | Open agent model/provider settings. |
| `/usage` |  | Open Wallets and refresh runtime usage. |
| `/alerts` | `/notifications` | Open the shared alert inbox. |
| `/brain` | `/vault` | Open the shared brain. |
| `/note <note>` |  | Save a note to the shared brain intake folder. |
| `/work` | `/kanban` | Open the work board. |
| `/handoff-task <machine> <task>` |  | Send a task to the best agent on a target machine. |
| `/swarm [number] <task>` |  | Spawn a best-suited team of configured chat-capable agents to work on the task in parallel and return a combined swarm packet. Omit the number for automatic sizing. |
| `/swarm-goal <build request>` |  | Rewrite a loose build request, append parallel `/goal` orchestration instructions, and submit it to Queen Bee with the server-owned app-build proof loop (browser/artifact/evidence gates plus independent evaluation). |
| `/swarm-sim <scenario>` |  | Launch a MiroShark simulation from the chat input and return the queued run status. |
| `/image-gen <prompt>` | `/imagine`, `/txt2img` | Generate an image through a connected Image Studio, ComfyUI, or Z-Image app and show the result as a native chat card. |

## Hermes And Gateway Commands

| Command | Aliases | Scope | Purpose |
| --- | --- | --- | --- |
| `/title [name]` |  | Session | Set a title for the current session. |
| `/handoff <platform>` |  | CLI | Hand off this session to a messaging platform. |
| `/branch [name]` | `/fork` | Session | Branch the current session. |
| `/compress [focus topic]` |  | Session | Manually compress conversation context. |
| `/rollback [number]` |  | Session | List or restore filesystem checkpoints. |
| `/snapshot [create|restore <id>|prune]` | `/snap` | CLI | Create or restore Hermes config/state snapshots. |
| `/stop` |  | Session | Kill running background processes. |
| `/approve [session|always]` |  | Gateway | Approve a pending dangerous command. |
| `/deny` |  | Gateway | Deny a pending dangerous command. |
| `/background <prompt>` | `/bg`, `/btw` | Session | Run a prompt in the background. |
| `/agents` | `/tasks` | Session | Show active agents and running tasks. |
| `/queue <prompt>` | `/q` | Session | Queue a prompt for the next turn. |
| `/steer <prompt>` |  | Session | Inject a note after the next tool call. |
| `/goal [text|pause|resume|clear|status]` |  | Session | Set or manage a persistent goal. |
| `/subgoal [text|remove N|clear]` |  | Session | Add or manage criteria on the active goal. |
| `/status` |  | Session | Show session info. |
| `/whoami` |  | Info | Show slash command access. |
| `/profile` |  | Info | Show active profile and home directory. |
| `/sethome` | `/set-home` | Gateway | Set this chat as the home channel. |
| `/resume [name]` |  | Session | Resume a named session. |
| `/sessions` |  | Session | Browse and resume previous sessions in native Hermes surfaces. |
| `/config` |  | CLI | Show current configuration. |
| `/model [model] [--provider name] [--global]` | `/provider` | Configuration | Switch model for this session. |
| `/codex-runtime [auto|codex_app_server]` | `/codex_runtime` | Configuration | Toggle Codex app-server runtime. |
| `/gquota` |  | CLI | Show Google Gemini Code Assist quota usage. |
| `/personality [name]` |  | Configuration | Set a predefined personality. |
| `/statusbar` | `/sb` | CLI | Toggle the context/model status bar. |
| `/verbose` |  | CLI | Cycle tool progress display. |
| `/footer [on|off|status]` |  | Configuration | Toggle gateway runtime metadata footer. |
| `/yolo` |  | Configuration | Toggle approval-free YOLO mode. |
| `/reasoning [level|show|hide]` |  | Configuration | Manage reasoning effort and display. |
| `/fast [normal|fast|status]` |  | Configuration | Toggle provider fast mode. |
| `/skin [name]` |  | CLI | Show or change the display skin/theme. |
| `/indicator [kaomoji|emoji|unicode|ascii]` |  | CLI | Pick the TUI busy indicator style. |
| `/voice [on|off|tts|status]` |  | Configuration | Toggle voice mode. |
| `/busy [queue|steer|interrupt|status]` |  | CLI | Control Enter behavior while Hermes is working. |
| `/tools [list|disable|enable] [name...]` |  | CLI | Manage tools. |
| `/toolsets` |  | CLI | List available toolsets. |
| `/skills` |  | CLI | Search, install, inspect, or manage skills. |
| `/bundles` |  | Tools & Skills | List skill bundles and aliases. |
| `/cron [subcommand]` |  | CLI | Manage scheduled tasks. |
| `/curator [status|run|pin|archive]` |  | Tools & Skills | Background skill maintenance. |
| `/kanban [subcommand]` |  | Tools & Skills | Use the collaboration board. |
| `/reload` |  | CLI | Reload environment variables. |
| `/reload-mcp` | `/reload_mcp` | Tools & Skills | Reload MCP servers from config. |
| `/reload-skills` | `/reload_skills` | Tools & Skills | Re-scan installed skills. |
| `/browser [connect|disconnect|status]` |  | CLI | Connect browser tools through CDP. |
| `/plugins` |  | CLI | List installed plugins and status. |
| `/commands [page]` |  | Gateway | Browse all commands and skills. |
| `/help` |  | Info | Show available commands. |
| `/restart` |  | Gateway | Gracefully restart the gateway. |
| `/usage` |  | Info | Show token usage and rate limits in native Hermes surfaces. |
| `/insights [days]` |  | Info | Show usage analytics. |
| `/platforms` | `/gateway` | CLI | Show gateway platform status. |
| `/platform <pause|resume|list> [name]` |  | Gateway | Pause, resume, or list a gateway platform. |
| `/copy [number]` |  | CLI | Copy the last assistant response. |
| `/paste` |  | CLI | Attach a clipboard image. |
| `/image <path>` |  | CLI | Attach a local image file. |
| `/update` |  | Info | Update Hermes Agent. |
| `/debug` |  | Info | Upload a debug report. |
| `/quit [--delete]` | `/exit` | Exit | Exit the CLI. |
| `/<skill-name>` |  | Dynamic | Invoke an installed Hermes skill by name. |

## Source Files

Dashboard commands live in:

```text
src/features/chat/dashboard-slash-commands.ts
```

Hermes command metadata used by the dashboard composer lives in:

```text
src/features/chat/chat-composer.tsx
```

Update this page whenever slash command names, aliases, scope, or behavior changes.
