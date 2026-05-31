# UsePod

UsePod is an OpenAI-compatible inference marketplace. In HivemindOS it is treated as a prepaid runtime rail for demand-side inference first, with provider-hosting documented separately because it exposes local compute to a marketplace.

## Demand-Side Inference

HivemindOS agents can use UsePod through the OpenAI-compatible runtime.

- Proxy base URL: `https://api.usepod.ai/proxy/<token>/v1`
- Chat path: `/chat/completions`
- Models path: `/models`
- Token env: `USEPOD_TOKEN`
- Deposit env: `USEPOD_DEPOSIT_ADDRESS`
- Optional input cap: `USEPOD_MAX_PRICE_INPUT_MICRO_USDC`
- Optional output cap: `USEPOD_MAX_PRICE_OUTPUT_MICRO_USDC`

The dashboard UsePod setup action registers a token through UsePod, saves the token and deposit address with `scripts/hive-env-add`, and configures the selected OpenAI-compatible agent with provider `usepod`. Runtime calls do not send a bearer token; the token lives in the UsePod proxy URL path.

UsePod response metadata is recorded in runtime telemetry when present:

- `X-Balance-Remaining`
- `X-Pod-Route`

## Spend Controls

UsePod price caps are microunits. HivemindOS maps the agent's UsePod advanced settings to:

- `X-Pod-Max-Price-Input`
- `X-Pod-Max-Price-Output`

Leave a cap empty to let UsePod route normally. Set both caps for agents that should only use routes under a known per-token ceiling.

## Provider Hosting

Provider hosting is intentionally not automated by HivemindOS setup. The audited `Sortis-AI/usepod-agent` repository shows a Rust provider agent that connects local backends such as vLLM, llama.cpp, LM Studio, Ollama, or BYOK providers to the UsePod coordinator over `wss://api.usepod.ai/provider/connect`.

Before running a provider agent, review:

- Operator and identity key handling.
- Backend bind addresses and Tailnet exposure.
- Bonding/funding requirements.
- Prometheus metrics exposure, commonly `127.0.0.1:9090`.
- Systemd or Docker lifecycle ownership.

Do not add pipe-to-shell provider install commands to HivemindOS automation. Prefer manual release downloads with checksums, Docker/systemd units reviewed by the operator, and private collector-only observability.

## Code Paths

- `src/lib/services/usepod.ts`
- `src/app/api/usepod/register/route.ts`
- `src/app/api/chat/agent-runtime/route.ts`
- `src/lib/services/runtime-adapters/openai-compatible.ts`
- `src/features/dashboard/views/chat/GuidedUsePodSetup.tsx`
- `src/features/dashboard/views/chat/AgentSettingsModal.tsx`
- `src/components/wallet/AgentWalletCard.tsx`

## References

- [UsePod quickstart](https://docs.usepod.ai/using/quickstart/)
- [UsePod drop-in API](https://docs.usepod.ai/using/drop-in-api/)
- [UsePod proxy API](https://docs.usepod.ai/api/proxy/)
- [UsePod spend controls](https://docs.usepod.ai/using/spend-controls/)
- [Sortis-AI/usepod-agent](https://github.com/Sortis-AI/usepod-agent)
