import { createIncidentBundle } from "./incident-bundle";
import type { IncidentStore } from "./incident-store";
import { createOpenSreClient, type OpenSreClient } from "./opensre-client";
import { getOpenSreConfig, SRE_PROVIDER_MATRIX } from "./provider-matrix";
import type {
  IncidentEventType,
  IncidentInvestigation,
  IncidentInvestigationInput,
  IncidentStatus,
  SreProviderId,
} from "./types";

type ServiceOptions = {
  store: IncidentStore;
  client?: OpenSreClient;
  now?: () => number;
  maxConcurrent?: number;
  onDiagnosed?: (incident: IncidentInvestigation) => Promise<void>;
};

function safeError(error: unknown) {
  if (!(error instanceof Error)) return "Investigation failed.";
  if (/^OpenSRE (?:investigation|is not|health)/.test(error.message)) return error.message.slice(0, 500);
  return "OpenSRE investigation failed without a usable diagnosis.";
}

export function createIncidentInvestigationService(options: ServiceOptions) {
  const store = options.store;
  const client = options.client ?? createOpenSreClient();
  const now = options.now ?? Date.now;
  const maxConcurrent = Math.max(1, Math.min(options.maxConcurrent ?? 1, 2));
  const pending: string[] = [];
  let active = 0;
  let idleResolvers: Array<() => void> = [];

  async function transition(
    id: string,
    status: IncidentStatus,
    eventType: IncidentEventType,
    patch: Partial<IncidentInvestigation> = {},
    detail?: string,
  ) {
    const incident = await store.mutateIncident(id, (current) => ({
      ...current,
      ...patch,
      status,
      updatedAt: now(),
    }));
    await store.appendEvent(id, {
      type: eventType,
      status,
      provider: incident.provider,
      ...(detail ? { detail } : {}),
    });
    return incident;
  }

  async function create(input: IncidentInvestigationInput) {
    const timestamp = now();
    const config = getOpenSreConfig();
    const provider: SreProviderId = config.enabled ? "opensre" : "native";
    const incident: IncidentInvestigation = {
      version: 1,
      id: store.createId("incident"),
      status: "captured",
      provider,
      createdAt: timestamp,
      updatedAt: timestamp,
      bundle: createIncidentBundle(input, { now }),
    };
    await store.writeIncident(incident);
    await store.appendEvent(incident.id, { type: "captured", status: "captured", provider });
    return incident;
  }

  async function processIncident(id: string) {
    const current = await store.readIncident(id);
    if (!current) throw new Error(`Incident ${id} was not found.`);
    const providerStatus = await client.status();
    if (!providerStatus.ready) {
      return transition(
        id,
        "degraded",
        "degraded",
        { provider: "opensre", degradedReason: providerStatus.reason ?? "OpenSRE is unavailable.", error: undefined },
        providerStatus.reason,
      );
    }
    await transition(id, "investigating", "investigation-started", {
      provider: "opensre",
      degradedReason: undefined,
      error: undefined,
    });
    try {
      const diagnosis = await client.investigate(current.bundle);
      const diagnosed = await transition(id, "diagnosed", "diagnosed", { diagnosis, error: undefined, degradedReason: undefined });
      await options.onDiagnosed?.(diagnosed).catch(() => undefined);
      return diagnosed;
    } catch (error) {
      const message = safeError(error);
      return transition(id, "failed", "failed", { error: message }, message);
    }
  }

  function resolveIdle() {
    if (active || pending.length) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  }

  function drain() {
    while (active < maxConcurrent && pending.length) {
      const id = pending.shift();
      if (!id) break;
      active += 1;
      void processIncident(id)
        .catch(() => undefined)
        .finally(() => {
          active -= 1;
          drain();
          resolveIdle();
        });
    }
    resolveIdle();
  }

  async function enqueue(id: string) {
    const current = await store.readIncident(id);
    if (!current) throw new Error(`Incident ${id} was not found.`);
    if (current.status === "diagnosed" || current.status === "investigating" || current.status === "queued") {
      return current;
    }
    const queued = await transition(id, "queued", "queued", {
      provider: "opensre",
      error: undefined,
      degradedReason: undefined,
    });
    if (!pending.includes(id)) pending.push(id);
    drain();
    return queued;
  }

  async function capture(input: IncidentInvestigationInput, runInvestigation = true) {
    const incident = await create(input);
    if (!runInvestigation) return incident;
    if (incident.provider === "native") {
      return transition(
        incident.id,
        "degraded",
        "degraded",
        { degradedReason: "Incident captured locally; no structured RCA provider is enabled." },
      );
    }
    return enqueue(incident.id);
  }

  async function retry(id: string) {
    const incident = await store.readIncident(id);
    if (!incident) throw new Error(`Incident ${id} was not found.`);
    if (!["degraded", "failed", "captured"].includes(incident.status)) {
      throw new Error(`Incident ${id} cannot be retried while ${incident.status}.`);
    }
    return enqueue(id);
  }

  async function status() {
    const opensre = await client.status();
    return {
      providers: [
        opensre,
        { ...SRE_PROVIDER_MATRIX.native, enabled: true, ready: true },
      ],
      queue: { active, pending: pending.length, maxConcurrent },
      policy: {
        providerAccess: "loopback-only",
        recommendationsRequireApproval: true,
        autonomousRemediation: false,
      },
    };
  }

  function waitForIdle() {
    if (!active && !pending.length) return Promise.resolve();
    return new Promise<void>((resolve) => idleResolvers.push(resolve));
  }

  return {
    capture,
    retry,
    processIncident,
    status,
    read: store.readIncident,
    list: store.listIncidents,
    events: store.listEvents,
    waitForIdle,
  };
}

export type IncidentInvestigationService = ReturnType<typeof createIncidentInvestigationService>;
