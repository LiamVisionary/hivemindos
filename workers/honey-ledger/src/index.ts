type Env = {
  DB: D1Database;
  HIVE_PER_MILLION_TOKENS?: string;
  OBSERVED_DAILY_TOKEN_CAP?: string;
  HONEY_LEDGER_SECRET?: string;
  HONEY_LEDGER_READ_TOKEN?: string;
  HONEY_LEDGER_ADMIN_TOKEN?: string;
  HONEY_REWARD_BANKR_API_KEY?: string;
  HIVE_TOKEN_ADDRESS?: string;
  CORS_ORIGIN?: string;
};

type UsageReceipt = {
  eventId: string;
  issuerId: string;
  workspaceId: string;
  agentId: string;
  tokensUsed: number;
  model: string;
  source: string;
  timestamp: string;
  signature?: string;
};

type ObservedUsage = Omit<UsageReceipt, "issuerId" | "signature">;

type AgentBalanceRow = {
  workspace_id: string;
  agent_id: string;
  tokens_used: number;
  lifetime_honey: number;
  available_honey: number;
  hive_balance: number;
  lifetime_honey_micro: number;
  available_honey_micro: number;
  hive_balance_micro: number;
  updated_at: string;
};

type RewardPoolState = {
  total_pool_micro: number;
  emitted_micro: number;
  exchanged_micro: number;
  total_pool_usd_micro: number;
  total_volume_usd_micro: number;
  updated_at: string;
};

const MICRO = 1_000_000;
const SWAP_FEE_BPS = 120;
const CREATOR_SHARE_BPS = 5700;
const HONEY_POOL_SHARE_BPS = 500;
const REWARD_POOL_SHARE_OF_VOLUME = (SWAP_FEE_BPS / 10_000) * (CREATOR_SHARE_BPS / 10_000) * (HONEY_POOL_SHARE_BPS / 10_000);
const BANKR_API_URL = "https://api.bankr.bot";

const jsonHeaders = (env: Env) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": env.CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
});

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: jsonHeaders(env) });

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return ok(env, { ok: true, service: "hivemindos-honey-ledger" });
      }
      if (request.method === "GET" && url.pathname === "/ledger") {
        return handleLedger(request, env, url);
      }
      if (request.method === "POST" && url.pathname === "/receipts") {
        return handleReceipt(request, env);
      }
      if (request.method === "POST" && url.pathname === "/observations") {
        return handleObservation(request, env);
      }
      if (request.method === "POST" && url.pathname === "/exchange") {
        return handleExchange(request, env);
      }
      if (request.method === "POST" && url.pathname === "/return-to-honey") {
        return handleReturnToHoney(request, env);
      }
      if (request.method === "POST" && url.pathname === "/claim-bankr-hive") {
        return handleClaimBankrHive(request, env);
      }
      if (request.method === "POST" && url.pathname === "/pool-events") {
        return handlePoolEvent(request, env);
      }
      return fail(env, "Not found.", 404);
    } catch (error) {
      console.error(error);
      return fail(env, "Internal ledger error.", 500);
    }
  },
};

export default worker;

async function handleReceipt(request: Request, env: Env) {
  if (!env.HONEY_LEDGER_SECRET) return fail(env, "Official Honey receipts require a trusted signer.", 500);

  const receipt = await request.json().catch(() => null);
  if (!isUsageReceipt(receipt)) return fail(env, "Invalid usage receipt.", 400);
  if (!receipt.signature) return fail(env, "Official Honey receipts must be signed by a trusted runtime.", 401);

  const expected = await signReceipt(receipt, env.HONEY_LEDGER_SECRET);
  if (!timingSafeEqual(receipt.signature, expected)) return fail(env, "Invalid receipt signature.", 401);

  await ensureRewardPoolState(env);
  const pool = await getRewardPoolState(env);
  const targetHoneyMicro = rewardForTokensMicro(env, receipt.tokensUsed);
  const poolRemainingMicro = Math.max(0, pool.total_pool_micro - pool.emitted_micro);
  const honeyDeltaMicro = Math.min(targetHoneyMicro, poolRemainingMicro);
  const honeyDelta = fromMicro(honeyDeltaMicro);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO usage_receipts
      (event_id, issuer_id, workspace_id, agent_id, tokens_used, honey_delta_micro, model, source, occurred_at, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      receipt.eventId,
      receipt.issuerId,
      receipt.workspaceId,
      receipt.agentId,
      receipt.tokensUsed,
      honeyDeltaMicro,
      receipt.model,
      receipt.source,
      receipt.timestamp,
      receipt.signature ?? "",
    )
    .run();

  if ((inserted.meta.changes ?? 0) > 0) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO agent_balances
          (workspace_id, agent_id, tokens_used, lifetime_honey, available_honey, lifetime_honey_micro, available_honey_micro, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
            tokens_used = tokens_used + excluded.tokens_used,
            lifetime_honey_micro = lifetime_honey_micro + excluded.lifetime_honey_micro,
            available_honey_micro = available_honey_micro + excluded.available_honey_micro,
            lifetime_honey = ROUND((lifetime_honey_micro + excluded.lifetime_honey_micro) / 1000000.0, 6),
            available_honey = ROUND((available_honey_micro + excluded.available_honey_micro) / 1000000.0, 6),
            updated_at = datetime('now')`,
      ).bind(receipt.workspaceId, receipt.agentId, receipt.tokensUsed, honeyDelta, honeyDelta, honeyDeltaMicro, honeyDeltaMicro),
      env.DB.prepare(
        `UPDATE reward_pool_state
          SET emitted_micro = emitted_micro + ?, updated_at = datetime('now')
          WHERE id = 1`,
      ).bind(honeyDeltaMicro),
    ]);
  }

  const balance = await getBalance(env, receipt.workspaceId, receipt.agentId);
  const updatedPool = await getRewardPoolState(env);
  return ok(env, { ok: true, duplicate: (inserted.meta.changes ?? 0) === 0, honeyDelta, balance, economics: toEconomics(env, updatedPool) });
}

async function handleObservation(request: Request, env: Env) {
  const observation = await request.json().catch(() => null);
  if (!isObservedUsage(observation)) return fail(env, "Invalid observed usage.", 400);

  await ensureRewardPoolState(env);
  const dailyCap = Math.max(0, Math.round(positiveNumber(env.OBSERVED_DAILY_TOKEN_CAP, 50_000)));
  const usedToday = await observedTokensToday(env, observation.workspaceId);
  const acceptedTokens = Math.max(0, Math.min(observation.tokensUsed, dailyCap - usedToday));
  if (acceptedTokens <= 0) {
    const pool = await getRewardPoolState(env);
    return ok(env, {
      ok: true,
      duplicate: false,
      capped: true,
      acceptedTokens: 0,
      honeyDelta: 0,
      economics: toEconomics(env, pool),
    });
  }

  const pool = await getRewardPoolState(env);
  const targetHoneyMicro = rewardForTokensMicro(env, acceptedTokens);
  const poolRemainingMicro = Math.max(0, pool.total_pool_micro - pool.emitted_micro);
  const honeyDeltaMicro = Math.min(targetHoneyMicro, poolRemainingMicro);
  const honeyDelta = fromMicro(honeyDeltaMicro);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO usage_receipts
      (event_id, issuer_id, workspace_id, agent_id, tokens_used, honey_delta_micro, model, source, occurred_at, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      observation.eventId,
      "hivemindos-runtime-observer",
      observation.workspaceId,
      observation.agentId,
      acceptedTokens,
      honeyDeltaMicro,
      observation.model,
      observation.source,
      observation.timestamp,
      "observed-runtime-usage",
    )
    .run();

  if ((inserted.meta.changes ?? 0) > 0) {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO agent_balances
          (workspace_id, agent_id, tokens_used, lifetime_honey, available_honey, lifetime_honey_micro, available_honey_micro, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
            tokens_used = tokens_used + excluded.tokens_used,
            lifetime_honey_micro = lifetime_honey_micro + excluded.lifetime_honey_micro,
            available_honey_micro = available_honey_micro + excluded.available_honey_micro,
            lifetime_honey = ROUND((lifetime_honey_micro + excluded.lifetime_honey_micro) / 1000000.0, 6),
            available_honey = ROUND((available_honey_micro + excluded.available_honey_micro) / 1000000.0, 6),
            updated_at = datetime('now')`,
      ).bind(observation.workspaceId, observation.agentId, acceptedTokens, honeyDelta, honeyDelta, honeyDeltaMicro, honeyDeltaMicro),
      env.DB.prepare(
        `UPDATE reward_pool_state
          SET emitted_micro = emitted_micro + ?, updated_at = datetime('now')
          WHERE id = 1`,
      ).bind(honeyDeltaMicro),
    ]);
  }

  const balance = await getBalance(env, observation.workspaceId, observation.agentId);
  const updatedPool = await getRewardPoolState(env);
  return ok(env, {
    ok: true,
    duplicate: (inserted.meta.changes ?? 0) === 0,
    capped: acceptedTokens < observation.tokensUsed,
    acceptedTokens,
    honeyDelta,
    balance,
    economics: toEconomics(env, updatedPool),
  });
}

async function handleLedger(request: Request, env: Env, url: URL) {
  const auth = requireBearer(request, env.HONEY_LEDGER_READ_TOKEN);
  if (auth) return fail(env, auth, 401);

  const workspaceId = cleanId(url.searchParams.get("workspaceId") ?? "");
  const agentId = cleanId(url.searchParams.get("agentId") ?? "");
  if (!workspaceId) return fail(env, "Missing workspaceId.", 400);

  const query = agentId
    ? env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ? ORDER BY agent_id").bind(workspaceId, agentId)
    : env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? ORDER BY agent_id").bind(workspaceId);
  const rows = await query.all<AgentBalanceRow>();
  await ensureRewardPoolState(env);
  const pool = await getRewardPoolState(env);
  const ledger = toHoneyLedger(env, rows.results ?? [], pool);
  return ok(env, { ok: true, ledger });
}

async function handleExchange(request: Request, env: Env) {
  await ensureRewardPoolState(env);
  const body = await request.json().catch(() => null) as { workspaceId?: string; agentId?: string } | null;
  const workspaceId = cleanId(body?.workspaceId ?? "");
  const agentId = cleanId(body?.agentId ?? "");
  if (!workspaceId) return fail(env, "Missing workspaceId.", 400);

  const balances = agentId
    ? await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?").bind(workspaceId, agentId).all<AgentBalanceRow>()
    : await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ?").bind(workspaceId).all<AgentBalanceRow>();

  const events = [];

  for (const row of balances.results ?? []) {
    const availableHoneyMicro = Math.max(0, Math.round(Number(row.available_honey_micro ?? 0)));
    if (availableHoneyMicro <= 0) continue;
    const availableHoney = fromMicro(availableHoneyMicro);
    const hiveDelta = availableHoney;
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE agent_balances
          SET available_honey = 0,
            available_honey_micro = 0,
            hive_balance_micro = hive_balance_micro + ?,
            hive_balance = ROUND((hive_balance_micro + ?) / 1000000.0, 6),
            updated_at = datetime('now')
          WHERE workspace_id = ? AND agent_id = ?`,
      ).bind(availableHoneyMicro, availableHoneyMicro, row.workspace_id, row.agent_id),
      env.DB.prepare(
        `INSERT INTO exchange_events (id, workspace_id, agent_id, honey_delta, hive_delta, honey_delta_micro, hive_delta_micro)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, row.workspace_id, row.agent_id, -availableHoney, hiveDelta, -availableHoneyMicro, availableHoneyMicro),
      env.DB.prepare(
        `UPDATE reward_pool_state
          SET exchanged_micro = exchanged_micro + ?, updated_at = datetime('now')
          WHERE id = 1`,
      ).bind(availableHoneyMicro),
    ]);
    events.push({ id, agentId: row.agent_id, honeyDelta: -availableHoney, hiveDelta });
  }

  const refreshed = agentId
    ? await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?").bind(workspaceId, agentId).all<AgentBalanceRow>()
    : await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ?").bind(workspaceId).all<AgentBalanceRow>();

  const pool = await getRewardPoolState(env);
  return ok(env, { ok: true, ledger: toHoneyLedger(env, refreshed.results ?? [], pool), events });
}

async function handleReturnToHoney(request: Request, env: Env) {
  await ensureRewardPoolState(env);
  const body = await request.json().catch(() => null) as { workspaceId?: string; agentId?: string } | null;
  const workspaceId = cleanId(body?.workspaceId ?? "");
  const agentId = cleanId(body?.agentId ?? "");
  if (!workspaceId) return fail(env, "Missing workspaceId.", 400);

  const balances = agentId
    ? await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?").bind(workspaceId, agentId).all<AgentBalanceRow>()
    : await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ?").bind(workspaceId).all<AgentBalanceRow>();

  const events = [];

  for (const row of balances.results ?? []) {
    const hiveBalanceMicro = Math.max(0, Math.round(Number(row.hive_balance_micro ?? 0)));
    const exchangeableHoneyMicro = Math.max(0, Math.round(Number(row.lifetime_honey_micro ?? 0) - Number(row.available_honey_micro ?? 0)));
    const honeyDeltaMicro = Math.min(hiveBalanceMicro, exchangeableHoneyMicro);
    if (honeyDeltaMicro <= 0) continue;
    const honeyDelta = fromMicro(honeyDeltaMicro);
    const hiveDelta = honeyDelta;
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE agent_balances
          SET available_honey_micro = available_honey_micro + ?,
            available_honey = ROUND((available_honey_micro + ?) / 1000000.0, 6),
            hive_balance_micro = hive_balance_micro - ?,
            hive_balance = ROUND((hive_balance_micro - ?) / 1000000.0, 6),
            updated_at = datetime('now')
          WHERE workspace_id = ? AND agent_id = ?`,
      ).bind(honeyDeltaMicro, honeyDeltaMicro, honeyDeltaMicro, honeyDeltaMicro, row.workspace_id, row.agent_id),
      env.DB.prepare(
        `INSERT INTO exchange_events (id, workspace_id, agent_id, honey_delta, hive_delta, honey_delta_micro, hive_delta_micro)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, row.workspace_id, row.agent_id, honeyDelta, -hiveDelta, honeyDeltaMicro, -honeyDeltaMicro),
      env.DB.prepare(
        `UPDATE reward_pool_state
          SET exchanged_micro = MAX(0, exchanged_micro - ?), updated_at = datetime('now')
          WHERE id = 1`,
      ).bind(honeyDeltaMicro),
    ]);
    events.push({ id, agentId: row.agent_id, honeyDelta, hiveDelta: -hiveDelta });
  }

  const refreshed = agentId
    ? await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?").bind(workspaceId, agentId).all<AgentBalanceRow>()
    : await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ?").bind(workspaceId).all<AgentBalanceRow>();

  const pool = await getRewardPoolState(env);
  return ok(env, { ok: true, ledger: toHoneyLedger(env, refreshed.results ?? [], pool), events });
}

async function handleClaimBankrHive(request: Request, env: Env) {
  await ensureRewardPoolState(env);
  const body = await request.json().catch(() => null) as { workspaceId?: string; agentId?: string; recipientAddress?: string } | null;
  const workspaceId = cleanId(body?.workspaceId ?? "");
  const agentId = cleanId(body?.agentId ?? "");
  const recipientAddress = String(body?.recipientAddress ?? "").trim();
  if (!workspaceId) return fail(env, "Missing workspaceId.", 400);
  if (!/^0x[a-fA-F0-9]{40}$/.test(recipientAddress)) return fail(env, "Missing valid recipientAddress.", 400);
  if (!env.HIVE_TOKEN_ADDRESS?.trim()) return fail(env, "HIVE_TOKEN_ADDRESS is not configured.", 500);
  if (!env.HONEY_REWARD_BANKR_API_KEY?.trim()) return fail(env, "Honey reward treasury is not configured.", 500);

  const balances = agentId
    ? await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?").bind(workspaceId, agentId).all<AgentBalanceRow>()
    : await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ?").bind(workspaceId).all<AgentBalanceRow>();

  const claimRows = (balances.results ?? [])
    .map((row) => ({
      row,
      availableHoneyMicro: Math.max(0, Math.round(Number(row.available_honey_micro ?? 0))),
    }))
    .filter((item) => item.availableHoneyMicro > 0);
  const totalHoneyMicro = claimRows.reduce((total, item) => total + item.availableHoneyMicro, 0);
  if (totalHoneyMicro <= 0) return fail(env, "No Honey is ready to claim.", 400);

  const amount = fromMicro(totalHoneyMicro);
  let txHash = "";
  try {
    txHash = await transferBankrHive(env, {
      tokenAddress: env.HIVE_TOKEN_ADDRESS.trim(),
      recipientAddress,
      amount,
    });
  } catch (error) {
    return fail(env, error instanceof Error ? error.message : "Bankr HIVE transfer failed.", 502);
  }
  if (!txHash) return fail(env, "Bankr HIVE transfer failed.", 502);

  const events = [];
  for (const { row, availableHoneyMicro } of claimRows) {
    const honeyDelta = fromMicro(availableHoneyMicro);
    const id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE agent_balances
          SET available_honey = 0,
            available_honey_micro = 0,
            updated_at = datetime('now')
          WHERE workspace_id = ? AND agent_id = ?`,
      ).bind(row.workspace_id, row.agent_id),
      env.DB.prepare(
        `INSERT INTO exchange_events (id, workspace_id, agent_id, honey_delta, hive_delta, honey_delta_micro, hive_delta_micro)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, row.workspace_id, row.agent_id, -honeyDelta, honeyDelta, -availableHoneyMicro, availableHoneyMicro),
      env.DB.prepare(
        `UPDATE reward_pool_state
          SET exchanged_micro = exchanged_micro + ?, updated_at = datetime('now')
          WHERE id = 1`,
      ).bind(availableHoneyMicro),
    ]);
    events.push({ id, agentId: row.agent_id, honeyDelta: -honeyDelta, hiveDelta: honeyDelta });
  }

  const refreshed = agentId
    ? await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?").bind(workspaceId, agentId).all<AgentBalanceRow>()
    : await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ?").bind(workspaceId).all<AgentBalanceRow>();

  const pool = await getRewardPoolState(env);
  return ok(env, {
    ok: true,
    ledger: toHoneyLedger(env, refreshed.results ?? [], pool),
    events,
    txHash,
    amount,
    recipientAddress,
    tokenAddress: env.HIVE_TOKEN_ADDRESS.trim(),
  });
}

async function handlePoolEvent(request: Request, env: Env) {
  const auth = requireBearer(request, env.HONEY_LEDGER_ADMIN_TOKEN);
  if (auth) return fail(env, auth, 401);

  await ensureRewardPoolState(env);
  const body = await request.json().catch(() => null) as {
    source?: string;
    tradeVolumeUsd?: number;
    hivePriceUsd?: number;
    hiveAmount?: number;
  } | null;

  const source = cleanId(body?.source ?? "manual-reward-pool");
  const tradeVolumeUsdMicro = moneyToMicro(body?.tradeVolumeUsd ?? 0);
  const hivePriceUsdMicro = moneyToMicro(body?.hivePriceUsd ?? 0);
  const manualHiveMicro = toMicro(body?.hiveAmount ?? 0);
  const rewardPoolUsdMicro = tradeVolumeUsdMicro > 0
    ? volumeToRewardPoolUsdMicro(tradeVolumeUsdMicro)
    : 0;
  const rewardPoolHiveMicro = rewardPoolUsdMicro > 0 && hivePriceUsdMicro > 0
    ? Math.floor((rewardPoolUsdMicro * MICRO) / hivePriceUsdMicro)
    : manualHiveMicro;

  if (rewardPoolHiveMicro <= 0) {
    return fail(env, "Pool event needs either tradeVolumeUsd + hivePriceUsd, or hiveAmount.", 400);
  }

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO reward_pool_events
        (id, source, trade_volume_usd_micro, hive_price_usd_micro, reward_pool_usd_micro, reward_pool_hive_micro)
        VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, source, tradeVolumeUsdMicro, hivePriceUsdMicro, rewardPoolUsdMicro, rewardPoolHiveMicro),
    env.DB.prepare(
      `UPDATE reward_pool_state
        SET total_pool_micro = total_pool_micro + ?,
          total_pool_usd_micro = total_pool_usd_micro + ?,
          total_volume_usd_micro = total_volume_usd_micro + ?,
          updated_at = datetime('now')
        WHERE id = 1`,
    ).bind(rewardPoolHiveMicro, rewardPoolUsdMicro, tradeVolumeUsdMicro),
  ]);

  const pool = await getRewardPoolState(env);
  return ok(env, {
    ok: true,
    event: {
      id,
      source,
      tradeVolumeUsd: fromMicro(tradeVolumeUsdMicro),
      rewardPoolUsd: fromMicro(rewardPoolUsdMicro),
      rewardPoolHive: fromMicro(rewardPoolHiveMicro),
    },
    economics: toEconomics(env, pool),
  });
}

async function getBalance(env: Env, workspaceId: string, agentId: string) {
  const row = await env.DB.prepare("SELECT * FROM agent_balances WHERE workspace_id = ? AND agent_id = ?")
    .bind(workspaceId, agentId)
    .first<AgentBalanceRow>();
  return row ? toBalance(row) : null;
}

function toHoneyLedger(env: Env, rows: AgentBalanceRow[], pool: RewardPoolState) {
  return {
    honeyPerThousandTokens: fromMicro(rewardForTokensMicro(env, 1000)),
    tokenPerHoney: 1,
    agentTokenUsage: Object.fromEntries(rows.map((row) => [row.agent_id, row.tokens_used])),
    agentHoneyExchanged: Object.fromEntries(rows.map((row) => [row.agent_id, fromMicro(Math.max(0, row.lifetime_honey_micro - row.available_honey_micro))])),
    agentHiveBalances: Object.fromEntries(rows.map((row) => [row.agent_id, fromMicro(row.hive_balance_micro)])),
    events: [],
    updatedAt: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, new Date(0).toISOString()),
    balances: rows.map(toBalance),
    ...toEconomics(env, pool),
  };
}

function toBalance(row: AgentBalanceRow) {
  return {
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    tokensUsed: row.tokens_used,
    lifetimeHoney: fromMicro(row.lifetime_honey_micro),
    availableHoney: fromMicro(row.available_honey_micro),
    hiveBalance: fromMicro(row.hive_balance_micro),
    updatedAt: row.updated_at,
  };
}

function isUsageReceipt(value: unknown): value is UsageReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<UsageReceipt>;
  return Boolean(
    cleanId(receipt.eventId ?? "") &&
    cleanId(receipt.issuerId ?? "") &&
    cleanId(receipt.workspaceId ?? "") &&
    cleanId(receipt.agentId ?? "") &&
    typeof receipt.model === "string" &&
    typeof receipt.source === "string" &&
    typeof receipt.timestamp === "string" &&
    typeof receipt.signature === "string" &&
    typeof receipt.tokensUsed === "number" &&
    Number.isInteger(receipt.tokensUsed) &&
    receipt.tokensUsed > 0,
  );
}

function isObservedUsage(value: unknown): value is ObservedUsage {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<UsageReceipt>;
  return Boolean(
    cleanId(receipt.eventId ?? "") &&
    cleanId(receipt.workspaceId ?? "") &&
    cleanId(receipt.agentId ?? "") &&
    typeof receipt.model === "string" &&
    /^observed-(hermes|openclaw|runtime)-usage$/.test(receipt.source ?? "") &&
    typeof receipt.timestamp === "string" &&
    typeof receipt.tokensUsed === "number" &&
    Number.isInteger(receipt.tokensUsed) &&
    receipt.tokensUsed > 0 &&
    receipt.tokensUsed <= 250_000,
  );
}

async function observedTokensToday(env: Env, workspaceId: string) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(tokens_used), 0) AS tokens
      FROM usage_receipts
      WHERE workspace_id = ?
        AND source IN ('observed-hermes-usage', 'observed-openclaw-usage', 'observed-runtime-usage')
        AND date(occurred_at) = date('now')`,
  ).bind(workspaceId).first<{ tokens: number }>();
  return Math.max(0, Math.round(Number(row?.tokens ?? 0)));
}

async function signReceipt(receipt: Omit<UsageReceipt, "signature">, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonicalReceipt(receipt)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalReceipt(receipt: Omit<UsageReceipt, "signature">) {
  return [
    receipt.issuerId,
    receipt.eventId,
    receipt.workspaceId,
    receipt.agentId,
    receipt.tokensUsed,
    receipt.model,
    receipt.source,
    receipt.timestamp,
  ].join(".");
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

function requireBearer(request: Request, token?: string) {
  if (!token) return null;
  const header = request.headers.get("Authorization") ?? "";
  return timingSafeEqual(header, `Bearer ${token}`) ? null : "Unauthorized.";
}

async function transferBankrHive(env: Env, input: { tokenAddress: string; recipientAddress: string; amount: number }) {
  const response = await fetch(`${BANKR_API_URL}/wallet/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.HONEY_REWARD_BANKR_API_KEY ?? "",
    },
    body: JSON.stringify({
      tokenAddress: input.tokenAddress,
      recipientAddress: input.recipientAddress,
      amount: input.amount.toFixed(6).replace(/\.?0+$/, ""),
      isNativeToken: false,
    }),
  });
  const data = await response.json().catch(() => null) as {
    success?: boolean;
    txHash?: string;
    error?: string;
    message?: string;
  } | null;
  if (!response.ok || !data?.success || !data.txHash) {
    throw new Error(data?.message || data?.error || "Bankr HIVE transfer failed.");
  }
  return data.txHash;
}

async function ensureRewardPoolState(env: Env) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO reward_pool_state
      (id, total_pool_micro, emitted_micro, exchanged_micro, total_pool_usd_micro, total_volume_usd_micro)
      VALUES (1, 0, 0, 0, 0, 0)`,
  ).run();
}

async function getRewardPoolState(env: Env): Promise<RewardPoolState> {
  await ensureRewardPoolState(env);
  const row = await env.DB.prepare("SELECT * FROM reward_pool_state WHERE id = 1").first<RewardPoolState>();
  return row ?? {
    total_pool_micro: 0,
    emitted_micro: 0,
    exchanged_micro: 0,
    total_pool_usd_micro: 0,
    total_volume_usd_micro: 0,
    updated_at: new Date(0).toISOString(),
  };
}

function toEconomics(env: Env, pool: RewardPoolState) {
  const emittedMicro = Math.max(0, Math.round(Number(pool.emitted_micro ?? 0)));
  const totalPoolMicro = Math.max(0, Math.round(Number(pool.total_pool_micro ?? 0)));
  return {
    rewardPoolHive: fromMicro(totalPoolMicro),
    rewardPoolRemainingHive: fromMicro(Math.max(0, totalPoolMicro - emittedMicro)),
    rewardPoolEmittedHive: fromMicro(emittedMicro),
    rewardPoolExchangedHive: fromMicro(Math.max(0, Math.round(Number(pool.exchanged_micro ?? 0)))),
    rewardPoolUsd: fromMicro(Math.max(0, Math.round(Number(pool.total_pool_usd_micro ?? 0)))),
    rewardPoolVolumeUsd: fromMicro(Math.max(0, Math.round(Number(pool.total_volume_usd_micro ?? 0)))),
    rewardPoolShareOfVolume: REWARD_POOL_SHARE_OF_VOLUME,
    hivePerMillionTokens: positiveNumber(env.HIVE_PER_MILLION_TOKENS, 1),
    hiveTokenAddress: env.HIVE_TOKEN_ADDRESS?.trim() ?? "",
  };
}

function rewardForTokensMicro(env: Env, tokensUsed: number) {
  const hivePerMillionTokens = positiveNumber(env.HIVE_PER_MILLION_TOKENS, 1);
  return Math.max(0, Math.floor((Math.max(0, Math.round(tokensUsed)) * hivePerMillionTokens * MICRO) / 1_000_000));
}

function volumeToRewardPoolUsdMicro(tradeVolumeUsdMicro: number) {
  const value = (BigInt(tradeVolumeUsdMicro) * BigInt(SWAP_FEE_BPS) * BigInt(CREATOR_SHARE_BPS) * BigInt(HONEY_POOL_SHARE_BPS))
    / 10_000n
    / 10_000n
    / 10_000n;
  return clampSafeInteger(value);
}

function moneyToMicro(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.round(numeric * MICRO));
}

function toMicro(value: unknown) {
  return moneyToMicro(value);
}

function fromMicro(value: number) {
  return Math.round(Math.max(0, value) * 1_000_000 / MICRO) / 1_000_000;
}

function clampSafeInteger(value: bigint) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(value > max ? max : value);
}

function cleanId(value: string) {
  return value.trim().slice(0, 160);
}

function positiveNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function ok(env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(env) });
}

function fail(env: Env, error: string, status: number) {
  return ok(env, { ok: false, error }, status);
}
