// Pure state + transitions for the Telegram $HIVE tip bot. Tips move balance
// inside this ledger; only deposits and withdrawals touch Base. No I/O in
// this file so scripts/test-telegram-tip-bot.mjs can exercise every
// transition under node --test.
//
// Transition contract: validate (and throw) BEFORE mutating, so a thrown
// transition leaves the state object untouched. The store layer additionally
// applies transitions to a clone, but tests rely on this ordering directly.

export type TipBotUser = {
  id: string;
  username?: string;
  firstName?: string;
  linkedWallets: string[];
  createdAt: string;
};

export type TipBotLedgerKind =
  | "tip"
  | "deposit"
  | "withdrawal"
  | "withdrawal-refund"
  | "claim-escrow"
  | "claim-credit"
  | "claim-refund";

export type TipBotLedgerEntry = {
  id: string;
  kind: TipBotLedgerKind;
  fromUserId?: string;
  toUserId?: string;
  amountRaw: string;
  chatId?: string;
  ref?: string;
  createdAt: string;
};

export type TipBotDeposit = {
  key: string; // `${txHash}:${logIndex}` — idempotency anchor
  txHash: string;
  logIndex: number;
  fromAddress: string;
  userId: string;
  amountRaw: string;
  blockNumber: string;
  creditedAt: string;
};

export type TipBotWithdrawalStatus = "pending" | "needs-review" | "processing" | "sent" | "failed" | "rejected";

export type TipBotWithdrawal = {
  id: string;
  userId: string;
  toAddress: string;
  amountRaw: string;
  status: TipBotWithdrawalStatus;
  provider: "treasury" | "bankr";
  attempts: number;
  txHash?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type TipBotClaimStatus = "open" | "claimed" | "refunded";

export type TipBotClaim = {
  token: string;
  fromUserId: string;
  toUsername: string;
  amountRaw: string;
  chatId?: string;
  status: TipBotClaimStatus;
  createdAt: string;
  expiresAt: string;
  claimedByUserId?: string;
  resolvedAt?: string;
};

export type TipBotState = {
  version: 1;
  settings: {
    paused: boolean;
    tokenSymbol: string;
    tokenDecimals: number;
    tokenAddress?: string;
    treasuryAddress?: string;
    withdrawalProvider?: "treasury" | "bankr";
    botUsername?: string;
    lastScannedBlock?: string;
  };
  users: Record<string, TipBotUser>;
  usernameIndex: Record<string, string>;
  balances: Record<string, string>;
  ledger: TipBotLedgerEntry[];
  deposits: Record<string, TipBotDeposit>;
  withdrawals: TipBotWithdrawal[];
  claims: Record<string, TipBotClaim>;
  updatedAt: string;
};

export function emptyTipBotState(): TipBotState {
  return {
    version: 1,
    settings: { paused: false, tokenSymbol: "HIVE", tokenDecimals: 18 },
    users: {},
    usernameIndex: {},
    balances: {},
    ledger: [],
    deposits: {},
    withdrawals: [],
    claims: {},
    updatedAt: new Date(0).toISOString(),
  };
}

export function balanceOf(state: TipBotState, userId: string): bigint {
  return BigInt(state.balances[userId] ?? "0");
}

function setBalance(state: TipBotState, userId: string, value: bigint) {
  if (value < 0n) throw new Error("Balance cannot go negative.");
  if (value === 0n) delete state.balances[userId];
  else state.balances[userId] = value.toString();
}

function assertSufficient(state: TipBotState, userId: string, amount: bigint, what: string) {
  if (balanceOf(state, userId) < amount) throw new Error(`Insufficient balance for ${what}.`);
}

function debit(state: TipBotState, userId: string, amount: bigint) {
  setBalance(state, userId, balanceOf(state, userId) - amount);
}

function credit(state: TipBotState, userId: string, amount: bigint) {
  setBalance(state, userId, balanceOf(state, userId) + amount);
}

function assertPositiveRaw(amountRaw: string): bigint {
  let value: bigint;
  try {
    value = BigInt(amountRaw);
  } catch {
    throw new Error("Invalid amount.");
  }
  if (value <= 0n) throw new Error("Amount must be greater than zero.");
  return value;
}

export function ensureUser(
  state: TipBotState,
  params: { id: string | number; username?: string | null; firstName?: string | null; createdAt: string },
): TipBotUser {
  const id = String(params.id);
  let user = state.users[id];
  if (!user) {
    user = { id, linkedWallets: [], createdAt: params.createdAt };
    state.users[id] = user;
  }
  const username = params.username?.trim() || undefined;
  if (username && user.username?.toLowerCase() !== username.toLowerCase()) {
    if (user.username) delete state.usernameIndex[user.username.toLowerCase()];
    user.username = username;
  }
  if (user.username) state.usernameIndex[user.username.toLowerCase()] = id;
  if (params.firstName?.trim()) user.firstName = params.firstName.trim();
  return user;
}

export function findUserByUsername(state: TipBotState, username: string): TipBotUser | null {
  const id = state.usernameIndex[username.replace(/^@/, "").toLowerCase()];
  return id ? state.users[id] ?? null : null;
}

export function applyTip(
  state: TipBotState,
  params: { id: string; fromUserId: string; toUserId: string; amountRaw: string; chatId?: string; createdAt: string },
): TipBotLedgerEntry {
  const amount = assertPositiveRaw(params.amountRaw);
  if (params.fromUserId === params.toUserId) throw new Error("You cannot tip yourself.");
  if (!state.users[params.toUserId]) throw new Error("Unknown tip recipient.");
  assertSufficient(state, params.fromUserId, amount, "this tip");
  debit(state, params.fromUserId, amount);
  credit(state, params.toUserId, amount);
  const entry: TipBotLedgerEntry = {
    id: params.id,
    kind: "tip",
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
    amountRaw: amount.toString(),
    chatId: params.chatId,
    createdAt: params.createdAt,
  };
  state.ledger.push(entry);
  return entry;
}

export function applyClaimEscrow(
  state: TipBotState,
  params: {
    id: string;
    token: string;
    fromUserId: string;
    toUsername: string;
    amountRaw: string;
    chatId?: string;
    createdAt: string;
    expiresAt: string;
  },
): TipBotClaim {
  const amount = assertPositiveRaw(params.amountRaw);
  if (state.claims[params.token]) throw new Error("Claim token collision.");
  assertSufficient(state, params.fromUserId, amount, "this tip");
  debit(state, params.fromUserId, amount);
  const claim: TipBotClaim = {
    token: params.token,
    fromUserId: params.fromUserId,
    toUsername: params.toUsername.replace(/^@/, ""),
    amountRaw: amount.toString(),
    chatId: params.chatId,
    status: "open",
    createdAt: params.createdAt,
    expiresAt: params.expiresAt,
  };
  state.claims[params.token] = claim;
  state.ledger.push({
    id: params.id,
    kind: "claim-escrow",
    fromUserId: params.fromUserId,
    amountRaw: claim.amountRaw,
    chatId: params.chatId,
    ref: params.token,
    createdAt: params.createdAt,
  });
  return claim;
}

export function applyClaimCredit(
  state: TipBotState,
  params: { id: string; token: string; userId: string; createdAt: string },
): TipBotClaim {
  const claim = state.claims[params.token];
  if (!claim || claim.status !== "open") throw new Error("This claim link is no longer valid.");
  if (claim.expiresAt <= params.createdAt) throw new Error("This claim link has expired.");
  if (claim.fromUserId === params.userId) throw new Error("You cannot claim your own tip.");
  credit(state, params.userId, BigInt(claim.amountRaw));
  claim.status = "claimed";
  claim.claimedByUserId = params.userId;
  claim.resolvedAt = params.createdAt;
  state.ledger.push({
    id: params.id,
    kind: "claim-credit",
    fromUserId: claim.fromUserId,
    toUserId: params.userId,
    amountRaw: claim.amountRaw,
    chatId: claim.chatId,
    ref: claim.token,
    createdAt: params.createdAt,
  });
  return claim;
}

export function applyClaimRefund(
  state: TipBotState,
  params: { id: string; token: string; createdAt: string },
): TipBotClaim {
  const claim = state.claims[params.token];
  if (!claim || claim.status !== "open") throw new Error("Claim is not open.");
  credit(state, claim.fromUserId, BigInt(claim.amountRaw));
  claim.status = "refunded";
  claim.resolvedAt = params.createdAt;
  state.ledger.push({
    id: params.id,
    kind: "claim-refund",
    toUserId: claim.fromUserId,
    amountRaw: claim.amountRaw,
    ref: claim.token,
    createdAt: params.createdAt,
  });
  return claim;
}

export function expireClaims(
  state: TipBotState,
  params: { now: string; makeEntryId: () => string },
): TipBotClaim[] {
  const expired = Object.values(state.claims).filter(
    (claim) => claim.status === "open" && claim.expiresAt <= params.now,
  );
  return expired.map((claim) =>
    applyClaimRefund(state, { id: params.makeEntryId(), token: claim.token, createdAt: params.now }),
  );
}

export function applyDepositCredit(
  state: TipBotState,
  params: {
    id: string;
    txHash: string;
    logIndex: number;
    fromAddress: string;
    userId: string;
    amountRaw: string;
    blockNumber: string;
    createdAt: string;
  },
): TipBotDeposit | null {
  const key = `${params.txHash.toLowerCase()}:${params.logIndex}`;
  if (state.deposits[key]) return null;
  const amount = assertPositiveRaw(params.amountRaw);
  if (!state.users[params.userId]) throw new Error("Unknown deposit user.");
  credit(state, params.userId, amount);
  const deposit: TipBotDeposit = {
    key,
    txHash: params.txHash.toLowerCase(),
    logIndex: params.logIndex,
    fromAddress: params.fromAddress.toLowerCase(),
    userId: params.userId,
    amountRaw: amount.toString(),
    blockNumber: params.blockNumber,
    creditedAt: params.createdAt,
  };
  state.deposits[key] = deposit;
  state.ledger.push({
    id: params.id,
    kind: "deposit",
    toUserId: params.userId,
    amountRaw: deposit.amountRaw,
    ref: key,
    createdAt: params.createdAt,
  });
  return deposit;
}

export function applyWithdrawalRequest(
  state: TipBotState,
  params: {
    id: string;
    entryId: string;
    userId: string;
    toAddress: string;
    amountRaw: string;
    provider: "treasury" | "bankr";
    needsReview: boolean;
    createdAt: string;
  },
): TipBotWithdrawal {
  const amount = assertPositiveRaw(params.amountRaw);
  assertSufficient(state, params.userId, amount, "this withdrawal");
  debit(state, params.userId, amount);
  const withdrawal: TipBotWithdrawal = {
    id: params.id,
    userId: params.userId,
    toAddress: params.toAddress,
    amountRaw: amount.toString(),
    status: params.needsReview ? "needs-review" : "pending",
    provider: params.provider,
    attempts: 0,
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };
  state.withdrawals.push(withdrawal);
  state.ledger.push({
    id: params.entryId,
    kind: "withdrawal",
    fromUserId: params.userId,
    amountRaw: withdrawal.amountRaw,
    ref: params.id,
    createdAt: params.createdAt,
  });
  return withdrawal;
}

export function findWithdrawal(state: TipBotState, id: string): TipBotWithdrawal | null {
  return state.withdrawals.find((withdrawal) => withdrawal.id === id) ?? null;
}

// Pops the oldest pending withdrawal into "processing" so the runner can send
// it without racing a second iteration. Returns a copy.
export function claimNextWithdrawal(state: TipBotState, now: string): TipBotWithdrawal | null {
  const next = state.withdrawals.find((withdrawal) => withdrawal.status === "pending");
  if (!next) return null;
  next.status = "processing";
  next.attempts += 1;
  next.updatedAt = now;
  return { ...next };
}

export function resolveWithdrawal(
  state: TipBotState,
  params: {
    id: string;
    status: "sent" | "failed" | "rejected" | "pending";
    txHash?: string;
    error?: string;
    refundEntryId?: string;
    updatedAt: string;
  },
): TipBotWithdrawal {
  const withdrawal = findWithdrawal(state, params.id);
  if (!withdrawal) throw new Error(`Unknown withdrawal: ${params.id}`);
  if ((params.status === "failed" || params.status === "rejected") && !params.refundEntryId) {
    throw new Error("refundEntryId is required when refunding a withdrawal.");
  }
  withdrawal.status = params.status;
  withdrawal.updatedAt = params.updatedAt;
  if (params.txHash) withdrawal.txHash = params.txHash;
  if (params.error !== undefined) withdrawal.error = params.error;
  if (params.status === "failed" || params.status === "rejected") {
    credit(state, withdrawal.userId, BigInt(withdrawal.amountRaw));
    state.ledger.push({
      id: params.refundEntryId as string,
      kind: "withdrawal-refund",
      toUserId: withdrawal.userId,
      amountRaw: withdrawal.amountRaw,
      ref: withdrawal.id,
      createdAt: params.updatedAt,
    });
  }
  return withdrawal;
}

export function approveWithdrawal(state: TipBotState, id: string, now: string): TipBotWithdrawal {
  const withdrawal = findWithdrawal(state, id);
  if (!withdrawal) throw new Error(`Unknown withdrawal: ${id}`);
  if (withdrawal.status !== "needs-review") throw new Error(`Withdrawal ${id} is ${withdrawal.status}, not needs-review.`);
  withdrawal.status = "pending";
  withdrawal.updatedAt = now;
  return withdrawal;
}

export type TipBotLeaderboardRow = { userId: string; totalRaw: string; count: number };

export function tipLeaderboard(
  state: TipBotState,
  params: { chatId?: string; sinceIso?: string } = {},
): { tippers: TipBotLeaderboardRow[]; receivers: TipBotLeaderboardRow[] } {
  const given = new Map<string, { total: bigint; count: number }>();
  const received = new Map<string, { total: bigint; count: number }>();
  const bump = (map: Map<string, { total: bigint; count: number }>, userId: string, amount: bigint) => {
    const row = map.get(userId) ?? { total: 0n, count: 0 };
    row.total += amount;
    row.count += 1;
    map.set(userId, row);
  };
  for (const entry of state.ledger) {
    if (params.chatId && entry.chatId !== params.chatId) continue;
    if (params.sinceIso && entry.createdAt < params.sinceIso) continue;
    const amount = BigInt(entry.amountRaw);
    // claim-escrow counts as "given" at send time; claim-credit counts as
    // "received" at claim time — so unclaimed tips still credit the tipper.
    if ((entry.kind === "tip" || entry.kind === "claim-escrow") && entry.fromUserId) bump(given, entry.fromUserId, amount);
    if ((entry.kind === "tip" || entry.kind === "claim-credit") && entry.toUserId) bump(received, entry.toUserId, amount);
  }
  const toRows = (map: Map<string, { total: bigint; count: number }>): TipBotLeaderboardRow[] =>
    [...map.entries()]
      .map(([userId, row]) => ({ userId, totalRaw: row.total.toString(), count: row.count }))
      .sort((left, right) => (BigInt(right.totalRaw) > BigInt(left.totalRaw) ? 1 : BigInt(right.totalRaw) < BigInt(left.totalRaw) ? -1 : 0));
  return { tippers: toRows(given), receivers: toRows(received) };
}

export function totalLiabilitiesRaw(state: TipBotState): bigint {
  let total = 0n;
  for (const amount of Object.values(state.balances)) total += BigInt(amount);
  for (const claim of Object.values(state.claims)) {
    if (claim.status === "open") total += BigInt(claim.amountRaw);
  }
  for (const withdrawal of state.withdrawals) {
    if (withdrawal.status === "pending" || withdrawal.status === "needs-review" || withdrawal.status === "processing") {
      total += BigInt(withdrawal.amountRaw);
    }
  }
  return total;
}
