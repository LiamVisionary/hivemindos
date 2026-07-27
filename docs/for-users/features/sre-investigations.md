---
title: "SRE Incident Investigations"
---

# SRE Incident Investigations

HivemindOS can preserve an operational incident as a small, redacted evidence bundle and ask an optional local root-cause provider to analyze it. Fleet Watchdog uses this path only after its normal health checks and bounded restart attempts have failed.

The default product works without the provider. Incidents are still captured locally, and the rest of HivemindOS remains available. During interactive setup, you can optionally install the reviewed [OpenSRE](https://github.com/Tracer-Cloud/opensre) sidecar for structured root-cause reports. OpenSRE is a third-party Apache-2.0 project and is not bundled into HivemindOS source.

## What gets captured

Each incident records:

- a short summary and severity;
- the failing service type, represented by a hashed target reference;
- bounded symptoms and probe evidence;
- remediation attempts that already happened;
- a status timeline from capture through diagnosis or failure.

HivemindOS removes credential-shaped fields, masks common secret patterns and IP addresses, replaces home-directory paths, hashes machine identifiers, and limits the depth and size of submitted data before it is stored or sent to the provider.

## Safety boundary

OpenSRE is an investigator, not an operator.

- The sidecar listens on loopback only.
- HivemindOS accepts only its reviewed, pinned source revision.
- The unrestricted OpenSRE interactive shell is not started.
- Telemetry, prompt logging, and history are disabled in the managed service.
- The managed service receives a minimal environment and does not inherit the Shared env credential collection.
- Returned remediation steps are recommendations. They cannot restart a service, change infrastructure, spend funds, or bypass a HivemindOS approval gate.

Any consequential follow-up must go through the same HivemindOS capability, permission, and human-approval checks as a normal agent action.

## Using it

After the optional sidecar is installed, ask an agent to investigate an operational incident or to check incident-investigation status. Agents can list and read previous reports, retry a failed analysis, or submit a new bounded bundle through the built-in `investigate_incident` capability.

When a diagnosis completes, HivemindOS posts a review-required alert with the root cause, confidence, incident reference, and bounded recommendations. It does not create executable work or write the diagnosis into Shared Brain Memory automatically; an operator or governed agent must review it first.

The managed sidecar uses a local Ollama provider by default. If no usable model is available, HivemindOS reports the provider as degraded and keeps the incident locally for a later retry instead of inventing a diagnosis.

## Storage and removal

Incident records live in the local HivemindOS operational store under `~/.hivemindos/ops/incidents`. Removing the optional sidecar does not delete those records. The uninstaller offers service removal and isolated-runtime removal separately, and preserves incident history unless you remove it yourself.
