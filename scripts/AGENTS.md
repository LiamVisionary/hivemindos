# Scripts And Setup Rules

These rules apply under `scripts/` in addition to the repository root instructions.

## Tests And Benchmarks

- Keep fast hermetic suites in `scripts/test-gate.mjs`; live/provider/fleet tests stay explicit and out of the default gate.
- Capture a baseline before modifying a gate or benchmark. Read the final output and report deltas, not just an exit code.
- Comparative benchmarks must grade the real outcome and proof before reporting latency, token, or cost improvement. Record parity, repeat count, intervention availability/use, and claim limits.
- Runtime and installer probes must be portable across platforms and sparse GUI-like `PATH` values.

## Dev Server Ownership

- Use `pnpm dev:ui` and a browser for UI iteration. Reserve `pnpm tauri:dev` for native behavior.
- Reuse one dev server. Check ports 5020 and 5021 before starting another process. Port 5020 is Liam's managed server: do not kill, restart, replace, or take it over without explicit permission.
- Use port 5021 or higher for isolated verification. Never use broad process cleanup such as `pkill node`.

## Setup And Uninstall Mirror

- Every install prompt, package, service, generated file, shell/profile edit, agent instruction block, shared-skill mirror, or third-party app added to setup needs a matching conservative one-by-one removal option in both uninstall scripts.
- Any shared-vault structure or instruction change must be mirrored in setup, uninstall where relevant, `scripts/seed-vault-foundation.mjs`, and desktop first-run initialization.
- Whole-brain architecture changes also update `docs/for-users/whole-brain/` and `scripts/test-vault-structure-contract.mjs`.
- Remove only managed blocks and exact service labels. Preserve surrounding user content and default destructive third-party removal to off.
