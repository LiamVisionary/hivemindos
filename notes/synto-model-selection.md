# Synto Model Selection Notes

Status: internal research note, not public user docs  
Last updated: 2026-07-09 17:15 PST+0800  
Scope: choosing local and cloud model lanes for HivemindOS/Synto reviewed synthesis.

## Summary

Confirmed: Synto is a background reviewed-synthesis pipeline, so model quality and structured-output reliability matter more than low interactive latency. The heavy compile path is allowed to be slow, but it must reliably return valid structured drafts under Synto's output caps.

Current recommendation:

- Local lowest-resource lane: `qwen3.5:9b`, only after Synto/HivemindOS passes `think: false` into Ollama.
- Local safest quality/resource candidate: `qwen3:30b`, because the matching hosted Qwen3 30B A3B 2507 lane completed a real Synto run cleanly and is non-thinking by default.
- Local highest-ceiling candidate: `qwen3.6:35b`, still unverified in Synto and only attractive after thinking-control support is wired through.
- Local mid-tier fallback: `qwen3.6:27b` only when Synto can disable thinking. As-is, the Qwen3.6 27B hosted trial spent output budget on reasoning and failed core pages.
- Cloud paid default lane: `qwen/qwen3-235b-a22b-2507`.
- Cloud budget lane: `qwen/qwen3-30b-a3b-instruct-2507`, with `deepseek/deepseek-v3.2` as the next alternative to benchmark.

The best surprising result is `qwen/qwen3-235b-a22b-2507`: it is non-thinking, Synto-compatible as-is, wrote all drafts in a real temp-vault run, and was cheaper on output than smaller Qwen3.5 candidates in the checked provider catalog.

The local update is that Qwen3.6 is promising only behind an explicit no-thinking path. On the same Synto fixture, Qwen3 30B A3B produced more complete graph coverage and fewer artifacts than Qwen3.6 27B with thinking disabled. Qwen3.6 35B-A3B remains a plausible local quality candidate, but it should not become the default until the client can reliably disable thinking and a real Synto run beats Qwen3 30B.

## 2026-07-09 Qwen3 30B vs Qwen3.6 27B Synto Trial Update

Confirmed hosted trial results:

- `qwen/qwen3-30b-a3b-instruct-2507` via OpenRouter completed the Synto fixture cleanly: 1 note ingested, 8 concepts extracted, 8 drafts compiled, structural health `100.0/100`, with only the expected source-summary graph-noise advisory. Runtime was 2m14s wall-clock.
- `qwen/qwen3.6-27b` via OpenRouter as-is ingested but compiled only 1 draft. Three core concepts (`Synto`, `HivemindOS`, `Qwen3`) truncated at Synto's 2400-token cap, leaving 7 lint issues and structural health `0.0/100`.
- `qwen/qwen3.6-27b` with OpenRouter reasoning disabled through a temporary local proxy completed: 1 note ingested, 5 concepts extracted, 5 drafts compiled, structural health `100.0/100`, runtime 1m49s wall-clock.
- Direct OpenRouter checks confirmed Qwen3.6 27B returns normal JSON with zero reasoning tokens when using `reasoning_effort: "none"`, `reasoning: {"enabled": false}`, or `reasoning: {"max_tokens": 0}`.

Quality read:

- Qwen3 30B produced the best Synto artifact on this fixture: more complete concept coverage, no truncation, clean graph health, and concise source-grounded drafts.
- Qwen3.6 27B with thinking disabled is viable but not automatically better. It was more verbose and structured, but inserted raw source filename text into prose and introduced a source-name typo in one draft.
- Qwen3.6 27B as-is is not Synto-safe because hidden reasoning consumes the output budget. This is a client integration issue, not necessarily a model-capability ceiling.

Local status:

- Exact local `qwen3:30b` was started through Ollama, but the pull did not complete during this session. It was stopped cleanly after flattening around `59%` / `11 GB / 18 GB`, with `ollama list` still empty, so no exact local Ollama Synto quality verdict exists yet.
- Existing LM Studio linked-device `qwen3.6-27b-mtp` failed a Synto run with `peer_keepalive_timeout`. A direct smoke showed reasoning output by default. This is a transport/client-compatibility failure, not a clean local model-quality verdict.

## Synto Workload Shape

Confirmed from installed Synto 0.4.0:

- Fast model: ingest, concept extraction, routing, structured decisions.
- Heavy model: draft article writing and final query answers.
- Embedding model: `nomic-embed-text` exists as a config default, but normal wiki/query paths say embeddings are not needed; embedding is only relevant to an optional RAG path.
- `synto doctor` checks fast and heavy model availability, not the embedding model.
- The compile path caps concept drafts with `pipeline.concept_draft_soft_cap`, defaulting to `2400` tokens.

Implication: background compile can tolerate seconds or minutes, but models that spend hidden thinking tokens and then hit `max_tokens` are poor Synto defaults unless the client can disable thinking.

## Local Model Findings

Verified Ollama registry sizes:

| Model | Pull size | Notes |
| --- | ---: | --- |
| `qwen3.5:4b` | 3.39 GB | Too small for final reviewed synthesis; possible ingest-only experiment. |
| `qwen3.5:9b` | 6.59 GB | Best low-resource local candidate; needs `think: false` hook for Synto. |
| `qwen3.6:27b` | 17.42 GB | Newer dense local tier; likely higher quality than Qwen3.5 27B but needs Synto trial. |
| `qwen3:30b` | 18.56 GB | Qwen3 30B A3B 2507 lane in Ollama; smaller than Qwen3.6 35B and likely Synto-friendly if non-thinking behavior holds. |
| `qwen3.6:35b` | 23.94 GB | Best local quality/resource candidate from the current search: 35B total / 3B activated MoE. |
| `qwen3.5:35b-a3b` | 23.87 GB | Superseded by Qwen3.6 35B-A3B unless testing shows regressions. |
| `qwen3:235b-a22b` | 142.15 GB | Not practical as a default local install. |
| `mistral-small3.2:24b` | 15.18 GB | Good cheap fallback; direct cloud probe was lower-ceiling than Qwen. |
| `gemma4:e4b` | 9.61 GB | Synto's historical fast default, but less attractive than Qwen3.5 9B for synthesis quality. |
| `gemma4:26b` | 17.99 GB | Plausible workstation fallback; not Synto-tested. |
| `gemma4:31b` | 19.87 GB | Plausible workstation fallback; not Synto-tested. |
| `gpt-oss:20b` | 13.79 GB | Not recommended until Synto supports the required harmony formatting cleanly. |
| `gpt-oss:120b` | 65.37 GB | Too large for a default local install and still has formatting caveats. |

Confirmed from Ollama docs: thinking can be disabled with top-level `think: false` in the API or `--think=false` in the CLI. Current installed Synto's `OllamaClient.generate()` posts to `/api/generate` without any `think` field, so local Qwen3.5 support needs a small client/config change before it is safe as the default.

Recommended local Synto layouts:

- Minimal local install: one model, `qwen3.5:9b` after `think:false` support. Lowest disk/RAM cost, but expect lower-confidence compiled pages and more review friction.
- Balanced local install: `qwen3.5:9b` as fast model plus `qwen3.6:35b` as heavy model. This is the preferred local quality/resource lane if the machine has enough unified memory or VRAM.
- Tighter workstation install: `qwen3.5:9b` as fast model plus `qwen3:30b` or `qwen3.6:27b` as heavy model. Use this if `qwen3.6:35b` causes memory pressure.
- Do not require local embeddings by default. Keep `nomic-embed-text` optional for RAG-specific paths.

Operational caveat: the pull size is not the whole runtime footprint. Ollama also needs memory for the loaded model, KV cache, and context window. Synto should cap local context and run heavy compiles during idle/background windows rather than trying to use giant 128K-256K contexts by default.

## Qwen3.5 9B vs 27B Quality

Test method: same HF Router/DeepInfra route, same prompts, `chat_template_kwargs: { enable_thinking: false }`, compact JSON output.

Results:

- Simple synthesis: both passed and produced usable JSON.
- Contradiction handling: `Qwen3.5-27B` was clearly better.
  - `9B` said Synto status was ambiguous/low-confidence.
  - `27B` correctly resolved the active config precedence and concluded Synto was effectively disabled/not running with high confidence.
- API cost gap on the tested route was large:
  - `Qwen3.5-9B`: $0.10/M input, $0.15/M output.
  - `Qwen3.5-27B`: $0.26/M input, $2.60/M output on HF/DeepInfra; OpenRouter showed lower output in one route but still much higher than 9B.

Recommendation: use `9B` for low-resource local/background ingest after `think:false`; use `27B` only when local hardware can tolerate the size and quality matters.

## Cloud Candidate Findings

Live catalog/pricing was checked through OpenRouter and the Hugging Face Router model/provider APIs. Prices below are dollars per 1M tokens from the checked catalog route at the time of this note.

| Candidate | Price input/output | Probe result | Recommendation |
| --- | ---: | --- | --- |
| `qwen/qwen3-235b-a22b-2507` | $0.09 / $0.10 | Full Synto temp-vault run succeeded: 1 note, 8 drafts, default 2400 cap, 3 lint issues. | Best paid cloud default. |
| `qwen/qwen3-30b-a3b-instruct-2507` | $0.048 / $0.193 | Full Synto temp-vault run succeeded: 1 note, 8 drafts, structural health 100/100. | Best budget cloud lane and current safest local proxy for `qwen3:30b`. |
| `qwen/qwen3.6-27b` | $0.285 / $2.40 | As-is Synto run truncated 3/4 core concepts; reasoning-disabled proxy run succeeded with 5 drafts and 100/100 structural health. | Only use after Synto can disable thinking; not cost-effective for cloud. |
| `deepseek/deepseek-v3.2` | $0.229 / $0.343 | Direct probes passed; conflict answer was precise. | Strong alternative; benchmark with real Synto run. |
| `deepseek/deepseek-v4-flash` | $0.09 / $0.18 | Synthesis passed, conflict probe truncated at 800 tokens. | Interesting but not Synto-default until cap behavior is tested. |
| `openai/gpt-oss-120b` | $0.03 / $0.15 | One probe truncated/invalid JSON; one passed but slow. Requires harmony formatting per model card. | Avoid as Synto default unless client/template support is added. |
| `mistralai/mistral-small-24b-instruct-2501` | $0.05 / $0.08 | Passed probes; output was more generic/lower ceiling. | Cheap fallback, not best quality. |
| `minimax/minimax-m2.5` | $0.12 / $0.48 | Synthesis passed; conflict probe failed/truncated. | Avoid for Synto default. |
| `meta-llama/llama-4-scout` | $0.10 / $0.30 | Fast and cheap; conflict handling was shallow/uncertain. | Not recommended for reviewed synthesis. |
| `qwen/qwen3.5-9b` | $0.10 / $0.15 | Works only when thinking is disabled; otherwise truncates in Synto-style calls. | Good budget lane after client support. |
| `qwen/qwen3.5-27b` | $0.195-$0.26 / $1.56-$2.60 | Better than 9B but too expensive versus Qwen3 235B 2507. | Skip for paid cloud default. |

## Real Synto Trial Evidence

### Qwen3.5-9B via HF Router/DeepInfra

Model: `Qwen/Qwen3.5-9B:deepinfra`  
Provider URL: `https://router.huggingface.co/v1`  
Vault: `/tmp/synto-deepinfra-trial-vault`

Results:

- Ingest succeeded.
- Compile with default `2400` cap failed 4/4 due truncation.
- Raising `concept_draft_soft_cap` to `8192` allowed one `HivemindOS.md` draft to compile.
- Draft quality was proof-of-life but not publish-ready: confidence `0.35`, single-source, and malformed wording artifacts such as `compromisingWikilinks`.

Conclusion: viable only after thinking-disable support; not good as-is.

### Qwen3 235B A22B 2507 via OpenRouter

Model: `qwen/qwen3-235b-a22b-2507`  
Provider URL: `https://openrouter.ai/api/v1`  
Vault: `/tmp/synto-qwen235-trial-vault`

Results:

- Ingested 1 note in 24.8s.
- Extracted 8 concepts with `quality=high`.
- Compiled 8 drafts in 173.5s at the default `2400` cap.
- `synto maintain --dry-run` scored structural health `88.9/100`.
- Issues: two malformed links in one draft and one graph-noise advisory.
- Drafts were coherent and source-grounded, but single-source and still review-required.

Conclusion: confirmed Synto-compatible and currently the best cloud synthesis default.

### Qwen3 30B A3B Instruct 2507 via OpenRouter

Model: `qwen/qwen3-30b-a3b-instruct-2507`  
Provider URL: `https://openrouter.ai/api/v1`  
Vault: `/tmp/synto-openrouter-qwen3-30b-vault3`

Results:

- Direct JSON-mode smoke test succeeded with HTTP 200 and no reasoning field.
- Ingested 1 note in 5.6s.
- Extracted 8 concepts with `quality=high`.
- Compiled 8 drafts in 127.7s at Synto's default 2400 concept cap.
- `synto maintain --dry-run` scored structural health `100.0/100`.
- Only issue was the expected source-summary graph-noise advisory.
- Drafts were concise and mostly source-grounded. They correctly preserved the active-vs-stale Synto status distinction.

Conclusion: strongest tested budget lane. Also the best evidence so far for local `qwen3:30b`, but exact local Ollama quality is still pending because the pull had not completed.

### Qwen3.6 27B via OpenRouter, default reasoning

Model: `qwen/qwen3.6-27b`  
Provider URL: `https://openrouter.ai/api/v1`  
Vault: `/tmp/synto-openrouter-qwen36-27b-vault3`

Results:

- Direct JSON-mode smoke test returned reasoning content and empty visible content within an 80-token cap.
- Ingested 1 note in 6.9s.
- Extracted only 4 concepts.
- Compiled 1 draft and failed 3 core concepts due truncation at `max_tokens=2400`.
- `synto maintain --dry-run` scored structural health `0.0/100` due broken links caused by the missing core concept pages.

Conclusion: not Synto-safe as-is. The failure mode is hidden/extra reasoning consuming the output budget.

### Qwen3.6 27B via OpenRouter, reasoning disabled

Model: `qwen/qwen3.6-27b`  
Provider URL: temporary local OpenRouter proxy adding `reasoning_effort: "none"` and `reasoning: {"enabled": false}`  
Vault: `/tmp/synto-openrouter-qwen36-27b-nothink-vault`

Results:

- Direct OpenRouter probes confirmed `reasoning_effort: "none"`, `reasoning: {"enabled": false}`, and `reasoning: {"max_tokens": 0}` each produced visible JSON with zero reasoning tokens.
- Ingested 1 note in 14.5s.
- Extracted 5 concepts.
- Compiled 5 drafts in 92.1s.
- `synto maintain --dry-run` scored structural health `100.0/100`.
- Drafts were usable but more verbose than Qwen3 30B and included source filename text in prose. One draft typoed the fixture source name.

Conclusion: model is viable only with thinking disabled. It did not beat Qwen3 30B on this Synto fixture.

### Qwen3.6 27B via LM Studio linked local model

Model: `qwen3.6-27b-mtp` in LM Studio / LM Link  
Provider URL: `http://127.0.0.1:1234/v1`  
Vault: `/tmp/synto-qwen36-27b-trial-vault`

Results:

- LM Studio loaded the linked model and exposed it through `/v1/models`.
- Synto failed ingest after 59s with `peer_keepalive_timeout`.
- Direct smoke with a small cap returned hidden reasoning content and empty visible content.
- LM Studio ignored `chat_template_kwargs: { enable_thinking: false }` in the tested request path.

Conclusion: this was not a clean local quality verdict. It showed that the current LM Link transport/client path is not reliable enough for Synto and still needs thinking control.

## Online Source Notes

Primary/current sources checked:

- Qwen3 235B A22B Instruct 2507 model card: https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507
  - Confirms Apache 2.0, 235B total / 22B activated, native 262K context, non-thinking mode only, improved writing and long-context capability.
- Qwen3 30B A3B Instruct 2507 model card: https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507
  - Confirms non-thinking mode only.
- Qwen3.5 collection/model cards: https://huggingface.co/collections/Qwen/qwen35
  - Confirms the relevant 9B and 27B sizes/classes; no 14B Qwen3.5 checkpoint found in the collection.
- Qwen3.6 35B-A3B model card: https://huggingface.co/Qwen/Qwen3.6-35B-A3B
  - Confirms Apache-2.0-compatible open weights, 35B total / 3B activated MoE, 262K native context, and improved agentic/coding capabilities versus prior Qwen lanes.
- Qwen3.6 Ollama catalog: https://ollama.com/library/qwen3.6
  - Confirms Ollama tags for `qwen3.6:27b` and `qwen3.6:35b`, with 17 GB and 24 GB catalog sizes.
- Ollama thinking docs: https://docs.ollama.com/capabilities/thinking
  - Confirms `think: false` / `--think=false`.
- Gemma 4 Ollama catalog: https://ollama.com/library/gemma4
  - Confirms Gemma 4 local model sizes and contexts for E4B, 26B, and 31B candidates.
- Mistral Small 3.2 Ollama catalog: https://ollama.com/library/mistral-small3.2
  - Confirms 24B local fallback size and 128K context.
- DeepSeek V3.2 model card: https://huggingface.co/deepseek-ai/DeepSeek-V3.2
  - Confirms MIT license and official model identity.
- GPT-OSS 120B model card: https://huggingface.co/openai/gpt-oss-120b
  - Confirms harmony-format requirement, 117B/5.1B active, and local/Ollama availability.
- OpenRouter live model API/catalog:
  - Used for current model IDs, context windows, and prices.
- Hugging Face Router APIs:
  - Used for provider availability and per-provider prices/structured-output flags where exposed.

Secondary scan notes:

- Artificial Analysis and current model roundups suggest DeepSeek V3.2 and newer Kimi/GLM/MiniMax families can beat or rival Qwen in some reasoning/coding benchmarks, but Synto cares about structured source-grounded writing, not only coding. The direct Synto-style probes did not beat Qwen3 235B 2507 enough to displace it.

## Open Follow-Ups

1. Patch the Synto integration or wrapper to support:
   - Ollama: top-level `think: false`.
   - OpenAI-compatible Qwen3.5 routes: `chat_template_kwargs: { enable_thinking: false }` where supported.
2. Run a real Synto temp-vault compile for:
   - `qwen3.6:35b`
   - exact local Ollama `qwen3.6:27b` after thinking control exists
   - exact local Ollama `qwen3:30b` after the pull completes
   - `deepseek/deepseek-v3.2`
   - `deepseek/deepseek-v4-flash` with a larger cap
3. Add a small repeatable Synto model benchmark fixture:
   - one straight synthesis note
   - one contradiction/stale-config note
   - one multi-source note with citation pressure
   - score parse success, lint count, confidence, unsupported-claim count, and cost.
4. For HivemindOS Cloud, route the paid feature through server-side budget and cost ledgers before enabling user-facing synthesis credits.
