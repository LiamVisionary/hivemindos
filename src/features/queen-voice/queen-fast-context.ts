"use client";

import {
  formatDashboardScreenContextForPrompt,
  type DashboardScreenContext,
} from "@/features/dashboard/screen-context";
import { isWalletBalanceReadQuery } from "@/lib/services/queen-bee/voice-conversation-policy";

type WalletReadinessProvider = {
  provider?: unknown;
  label?: unknown;
  configured?: unknown;
  ready?: unknown;
  spendReady?: unknown;
  missing?: unknown;
};

type WalletReadinessResponse = {
  ok?: unknown;
  error?: unknown;
  generatedAt?: unknown;
  providers?: unknown;
};

type FastContextItem = {
  kind?: unknown;
  title?: unknown;
  summary?: unknown;
  route?: unknown;
  path?: unknown;
  score?: unknown;
  load?: unknown;
};

type FastContextIndexResponse = {
  ok?: unknown;
  error?: unknown;
  totalMatches?: unknown;
  items?: unknown;
};

type FastMemoryResponse = {
  ok?: unknown;
  error?: unknown;
  answer?: unknown;
  hits?: unknown;
};

type FastKnowledgeResponse = {
  ok?: unknown;
  error?: unknown;
  search?: unknown;
};

type FastAccessHistoryResponse = {
  ok?: unknown;
  error?: unknown;
  context?: unknown;
};

const FAST_CONTEXT_TIMEOUT_MS = 1_500;
const FAST_CONTEXT_KINDS = [
  "skill",
  "tool-schema",
  "api-route",
  "connected-app",
  "app-endpoint",
  "runtime",
  "doc",
  "workspace-file",
  "code-route",
  "repo-architecture",
];

export async function fetchHivemindFastContext(
  rawQuery: string,
  screenContext?: DashboardScreenContext,
) {
  const query =
    rawQuery.trim() || screenContext?.viewLabel || "HivemindOS app and brain context";
  if (isWalletBalanceReadQuery(query)) {
    const data = await postJsonWithTimeout<{ ok?: unknown; result?: unknown }>(
      "/api/queen-bee/voice",
      { action: "read-wallet-balances", query },
      15_000,
    );
    return typeof data.result === "string"
      ? data.result
      : "The HivemindOS wallet reader returned no balance evidence.";
  }
  const [contextIndex, memory, knowledge, accessHistory] = await Promise.allSettled([
    postJsonWithTimeout<FastContextIndexResponse>(
      "/api/context-index",
      {
        query,
        limit: 8,
        kinds: FAST_CONTEXT_KINDS,
        includeConnectedApps: true,
        includeRuntimeProviders: true,
      },
      FAST_CONTEXT_TIMEOUT_MS,
    ),
    postJsonWithTimeout<FastMemoryResponse>(
      "/api/brain/memory",
      {
        action: "answer",
        query,
        limit: 5,
        trackUsage: true,
        usageContext: "queen-bee-fast-context",
      },
      FAST_CONTEXT_TIMEOUT_MS,
    ),
    postJsonWithTimeout<FastKnowledgeResponse>(
      "/api/brain/knowledge",
      {
        action: "search",
        query,
        limit: 5,
      },
      FAST_CONTEXT_TIMEOUT_MS,
    ),
    postJsonWithTimeout<FastAccessHistoryResponse>(
      "/api/brain/access-insights",
      {},
      FAST_CONTEXT_TIMEOUT_MS,
    ),
  ]);

  return formatHivemindFastContext({
    query,
    screenContext,
    contextIndex,
    memory,
    knowledge,
    accessHistory,
  });
}

export async function fetchXAccountRead(input: Record<string, unknown>) {
  const data = await postJsonWithTimeout<{ ok?: unknown; result?: unknown; error?: unknown }>(
    "/api/queen-bee/voice",
    { action: "read-x-account", ...input },
    8_000,
  );
  if (data.ok === false) {
    throw new Error(typeof data.error === "string" ? data.error : "X account read failed.");
  }
  return typeof data.result === "string"
    ? data.result
    : "The connected X account returned no readable result.";
}

async function postJsonWithTimeout<T>(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | (T & { error?: unknown })
      | null;
    if (!res.ok || !data) {
      const error =
        typeof data?.error === "string"
          ? data.error
          : `${url} returned ${res.status}`;
      throw new Error(error);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function formatHivemindFastContext(input: {
  query: string;
  screenContext?: DashboardScreenContext;
  contextIndex: PromiseSettledResult<FastContextIndexResponse>;
  memory: PromiseSettledResult<FastMemoryResponse>;
  knowledge: PromiseSettledResult<FastKnowledgeResponse>;
  accessHistory: PromiseSettledResult<FastAccessHistoryResponse>;
}) {
  const lines = [
    `Fast read-only HivemindOS context for: ${compactFastText(input.query, 180)}`,
    input.screenContext?.viewLabel
      ? `Current screen: ${input.screenContext.viewLabel} (${input.screenContext.view}).`
      : "",
    "Use this evidence to answer briefly. If a source timed out or has no hit, say what is unverified. No actions were executed.",
    "",
    ...formatContextIndexSection(input.contextIndex),
    "",
    ...formatMemorySection(input.memory),
    "",
    ...formatKnowledgeSection(input.knowledge),
    "",
    ...formatAccessHistorySection(input.accessHistory),
  ].filter((line, index, all) => line || all[index - 1] !== "");
  return lines.join("\n");
}

function formatAccessHistorySection(
  result: PromiseSettledResult<FastAccessHistoryResponse>,
) {
  if (result.status === "rejected") {
    return [
      `Brain note access history: unavailable (${compactFastText(result.reason, 180)}).`,
    ];
  }
  if (result.value.ok === false) {
    return [
      `Brain note access history: unavailable (${compactFastText(result.value.error, 180)}).`,
    ];
  }
  const context = typeof result.value.context === "string"
    ? result.value.context.trim()
    : "";
  return [context || "Brain note access history: no evidence returned."];
}

function formatContextIndexSection(result: PromiseSettledResult<FastContextIndexResponse>) {
  if (result.status === "rejected") {
    return [
      `App/capability index: unavailable (${compactFastText(result.reason, 180)}).`,
    ];
  }
  if (result.value.ok === false) {
    return [
      `App/capability index: unavailable (${compactFastText(result.value.error, 180)}).`,
    ];
  }
  const items = fastContextItems(result.value.items).slice(0, 6);
  if (!items.length) {
    return ["App/capability index: no matching app, route, tool, runtime, or doc hits."];
  }
  return [
    `App/capability index: ${items.length} shown${
      typeof result.value.totalMatches === "number"
        ? ` of ${result.value.totalMatches}`
        : ""
    }.`,
    ...items.map(
      (item, index) =>
        `${index + 1}. ${fastItemTitle(item)} (${compactFastText(item.kind, 40)}${
          typeof item.score === "number" ? `, score ${item.score}` : ""
        }) - ${compactFastText(item.summary, 220)}${fastItemLocator(item)}`,
    ),
  ];
}

function formatMemorySection(result: PromiseSettledResult<FastMemoryResponse>) {
  if (result.status === "rejected") {
    return [
      `Shared Brain Memory: unavailable (${compactFastText(result.reason, 180)}).`,
    ];
  }
  if (result.value.ok === false) {
    return [
      `Shared Brain Memory: unavailable (${compactFastText(result.value.error, 180)}).`,
    ];
  }
  const answer = typeof result.value.answer === "string" ? result.value.answer.trim() : "";
  return [
    `Shared Brain Memory: ${
      answer ? compactFastText(answer, 900) : "no matching memory answer returned."
    }`,
  ];
}

function formatKnowledgeSection(result: PromiseSettledResult<FastKnowledgeResponse>) {
  if (result.status === "rejected") {
    return [
      `Compiled Brain Knowledge: unavailable (${compactFastText(result.reason, 180)}).`,
    ];
  }
  if (result.value.ok === false) {
    return [
      `Compiled Brain Knowledge: unavailable (${compactFastText(result.value.error, 180)}).`,
    ];
  }
  const search =
    result.value.search && typeof result.value.search === "object"
      ? (result.value.search as { results?: unknown })
      : null;
  const results = Array.isArray(search?.results)
    ? search.results
        .filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
        .slice(0, 4)
    : [];
  if (!results.length) return ["Compiled Brain Knowledge: no matching compiled-wiki hits."];
  return [
    `Compiled Brain Knowledge: ${results.length} hit${results.length === 1 ? "" : "s"}.`,
    ...results.map(
      (item, index) =>
        `${index + 1}. ${compactFastText(item.title || item.slug || "Untitled", 120)} (${compactFastText(item.type, 40)}${
          typeof item.score === "number" ? `, score ${item.score}` : ""
        }) - ${compactFastText(item.snippet || item.path, 220)}`,
    ),
  ];
}

function fastContextItems(value: unknown): FastContextItem[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is FastContextItem => Boolean(item) && typeof item === "object",
      )
    : [];
}

function fastItemTitle(item: FastContextItem) {
  return compactFastText(item.title || item.route || item.path || "Untitled", 120);
}

function fastItemLocator(item: FastContextItem) {
  const load =
    item.load && typeof item.load === "object"
      ? (item.load as { target?: unknown; note?: unknown })
      : null;
  const locator = item.route || item.path || load?.target || load?.note;
  return locator ? ` [${compactFastText(locator, 120)}]` : "";
}

function compactFastText(value: unknown, maxLength: number) {
  const compacted = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export async function fetchWalletReadiness(screenContext?: DashboardScreenContext) {
  const res = await fetch("/api/crypto/capabilities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(walletReadinessRequestBody(screenContext)),
  });
  const data = (await res.json().catch(() => null)) as WalletReadinessResponse | null;
  if (!res.ok || !data || data.ok === false) {
    const error =
      typeof data?.error === "string"
        ? data.error
        : "The wallet capability route did not return readiness.";
    return `Wallet readiness is not reachable right now: ${error}`;
  }
  return formatWalletReadiness(data);
}

function walletReadinessRequestBody(screenContext?: DashboardScreenContext) {
  const actingWallet = screenContext?.actingWallet ?? undefined;
  const body: Record<string, unknown> = {
    action: "status",
    intent: "status",
  };
  if (actingWallet?.id && actingWallet.id !== "bankr") body.agentId = actingWallet.id;
  const wallet = walletPolicyFromActingWallet(actingWallet);
  if (wallet) body.wallet = wallet;
  return body;
}

function walletPolicyFromActingWallet(
  wallet: DashboardScreenContext["actingWallet"] | undefined,
) {
  if (!wallet) return undefined;
  const provider = normalizeWalletProvider(wallet.provider || wallet.kind);
  const policy: Record<string, unknown> = {};
  if (wallet.id) policy.agentId = wallet.id;
  if (provider) policy.provider = provider;
  if (wallet.address) {
    policy.walletAddress = wallet.address;
    policy.vaultAddress = wallet.address;
  }
  if (wallet.network) policy.network = wallet.network;
  if (Number(wallet.capUsd) > 0) {
    policy.maxPaymentUsd = wallet.capUsd;
    policy.maxTradeUsd = wallet.capUsd;
  }
  return Object.keys(policy).length ? policy : undefined;
}

function normalizeWalletProvider(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
  if (["bankr", "moneyclaw", "x402", "usepod", "venice", "veil"].includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function formatWalletReadiness(data: WalletReadinessResponse) {
  const providers = Array.isArray(data.providers)
    ? data.providers.filter(
        (provider): provider is WalletReadinessProvider =>
          Boolean(provider) && typeof provider === "object",
      )
    : [];
  if (!providers.length) {
    return "Wallet readiness was checked, but no payment rail rows were returned. No balances, deposit addresses, private addresses, or spend actions were fetched or executed.";
  }

  const spendReady = providers.filter((provider) => provider.spendReady === true);
  const configuredGated = providers.filter(
    (provider) => provider.configured === true && provider.spendReady !== true,
  );
  const needsSetup = providers.filter((provider) => provider.configured !== true);
  const readyButNotSpend = providers.filter(
    (provider) =>
      provider.ready === true &&
      provider.spendReady !== true &&
      provider.configured !== true,
  );

  const lines = [
    "Read-only wallet readiness from the live HivemindOS capability map:",
    `Spend-ready now: ${providerList(spendReady) || "none"}.`,
    `Configured but gated: ${providerList(configuredGated, true) || "none"}.`,
    `Needs setup or policy: ${
      providerList([...needsSetup, ...readyButNotSpend], true) || "none"
    }.`,
    "No balances, deposit addresses, private addresses, or spend actions were fetched or executed.",
  ];
  return lines.join("\n");
}

function providerList(providers: WalletReadinessProvider[], includeReason = false) {
  return providers
    .map((provider) => providerLabel(provider, includeReason))
    .filter(Boolean)
    .join(", ");
}

function providerLabel(provider: WalletReadinessProvider, includeReason: boolean) {
  const label = String(provider.label || provider.provider || "").trim();
  if (!label) return "";
  if (!includeReason) return label;
  const missing = Array.isArray(provider.missing)
    ? provider.missing.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (!missing.length) return label;
  return `${label} (${missing.slice(0, 2).join("; ")})`;
}

export function withScreenContext(
  message: string,
  screenContext?: DashboardScreenContext,
) {
  const context = formatDashboardScreenContextForPrompt(screenContext);
  const trimmed = message.trim();
  if (!context) return trimmed;
  return `${context}\n\nUser request: ${trimmed}`;
}

/** The acting wallet as a structured source hint for the executing agent's
 *  send/swap resolver - full address included (it is not regex-parsed here). */
export function actingWalletSourceFromContext(screenContext?: DashboardScreenContext) {
  const wallet = screenContext?.actingWallet;
  if (!wallet?.id) return undefined;
  return {
    agentId: wallet.id,
    address: wallet.address || "",
    network: wallet.network || "",
    kind: wallet.kind || "",
  };
}
