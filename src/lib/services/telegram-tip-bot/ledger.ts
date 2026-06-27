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
  | "claim-refund"
  | "bounty-create"
  | "bounty-boost"
  | "bounty-refund"
  | "bounty-payout";

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

export type TipBotBountyStatus =
  | "open"
  | "funding"
  | "active"
  | "submitted"
  | "accepted"
  | "paid"
  | "expired"
  | "cancelled"
  | "disputed";

export type TipBotBountyBoost = {
  id: string;
  userId: string;
  amountRaw: string;
  createdAt: string;
  refundedAt?: string;
};

export type TipBotBountySubmission = {
  id: string;
  userId: string;
  text: string;
  createdAt: string;
};

export type TipBotBounty = {
  id: string;
  title: string;
  creatorUserId: string;
  chatId?: string;
  rewardRaw: string;
  status: TipBotBountyStatus;
  dueAt?: string;
  boosts: TipBotBountyBoost[];
  submissions: TipBotBountySubmission[];
  winnerUserId?: string;
  acceptedSubmissionId?: string;
  createdAt: string;
  updatedAt: string;
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
  bounties: Record<string, TipBotBounty>;
  memberTags?: {
    chatIds: string[];
    lastSynced: Record<string, Record<string, string>>;
    lastSyncAt?: string;
  };
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
    bounties: {},
    memberTags: { chatIds: [], lastSynced: {} },
    updatedAt: new Date(0).toISOString(),
  };
}

function bounties(state: TipBotState): Record<string, TipBotBounty> {
  state.bounties ??= {};
  return state.bounties;
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

function assertMutableBounty(bounty: TipBotBounty) {
  if (bounty.status === "paid" || bounty.status === "cancelled" || bounty.status === "expired") {
    throw new Error(`Bounty ${bounty.id} is ${bounty.status}.`);
  }
}

function bountyEscrowRaw(bounty: TipBotBounty): bigint {
  return BigInt(bounty.rewardRaw) + bounty.boosts.reduce((total, boost) => total + (boost.refundedAt ? 0n : BigInt(boost.amountRaw)), 0n);
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

export function applyBountyCreate(
  state: TipBotState,
  params: {
    id: string;
    entryId: string;
    creatorUserId: string;
    title: string;
    rewardRaw: string;
    chatId?: string;
    dueAt?: string;
    createdAt: string;
  },
): TipBotBounty {
  const title = params.title.replace(/\s+/g, " ").trim().slice(0, 180);
  if (!title) throw new Error("Bounty title is required.");
  if (bounties(state)[params.id]) throw new Error(`Bounty ${params.id} already exists.`);
  const reward = assertPositiveRaw(params.rewardRaw);
  assertSufficient(state, params.creatorUserId, reward, "this bounty");
  debit(state, params.creatorUserId, reward);
  const bounty: TipBotBounty = {
    id: params.id,
    title,
    creatorUserId: params.creatorUserId,
    chatId: params.chatId,
    rewardRaw: reward.toString(),
    status: "open",
    dueAt: params.dueAt,
    boosts: [],
    submissions: [],
    createdAt: params.createdAt,
    updatedAt: params.createdAt,
  };
  bounties(state)[params.id] = bounty;
  state.ledger.push({
    id: params.entryId,
    kind: "bounty-create",
    fromUserId: params.creatorUserId,
    amountRaw: bounty.rewardRaw,
    chatId: params.chatId,
    ref: params.id,
    createdAt: params.createdAt,
  });
  return bounty;
}

export function applyBountyBoost(
  state: TipBotState,
  params: { id: string; entryId: string; boostId: string; userId: string; amountRaw: string; createdAt: string },
): TipBotBounty {
  const bounty = findBounty(state, params.id);
  if (!bounty) throw new Error(`Unknown bounty: ${params.id}`);
  assertMutableBounty(bounty);
  if (bounty.status === "accepted" || bounty.status === "disputed") {
    throw new Error(`Bounty ${params.id} is ${bounty.status} and cannot be boosted.`);
  }
  const amount = assertPositiveRaw(params.amountRaw);
  assertSufficient(state, params.userId, amount, "this bounty boost");
  debit(state, params.userId, amount);
  bounty.boosts.push({ id: params.boostId, userId: params.userId, amountRaw: amount.toString(), createdAt: params.createdAt });
  if (bounty.status === "open" || bounty.status === "funding") bounty.status = "active";
  bounty.updatedAt = params.createdAt;
  state.ledger.push({
    id: params.entryId,
    kind: "bounty-boost",
    fromUserId: params.userId,
    amountRaw: amount.toString(),
    chatId: bounty.chatId,
    ref: params.id,
    createdAt: params.createdAt,
  });
  return bounty;
}

export function applyBountySubmission(
  state: TipBotState,
  params: { id: string; submissionId: string; userId: string; text: string; createdAt: string },
): TipBotBounty {
  const bounty = findBounty(state, params.id);
  if (!bounty) throw new Error(`Unknown bounty: ${params.id}`);
  assertMutableBounty(bounty);
  if (bounty.status === "accepted" || bounty.status === "disputed") {
    throw new Error(`Bounty ${params.id} is ${bounty.status} and cannot accept submissions.`);
  }
  const text = params.text.trim().slice(0, 600);
  if (!text) throw new Error("Submission text or URL is required.");
  bounty.submissions.push({ id: params.submissionId, userId: params.userId, text, createdAt: params.createdAt });
  bounty.status = "submitted";
  bounty.updatedAt = params.createdAt;
  return bounty;
}

export function applyBountyPayout(
  state: TipBotState,
  params: { id: string; entryId: string; winnerUserId: string; acceptedSubmissionId?: string; updatedAt: string },
): TipBotBounty {
  const bounty = findBounty(state, params.id);
  if (!bounty) throw new Error(`Unknown bounty: ${params.id}`);
  assertMutableBounty(bounty);
  if (!state.users[params.winnerUserId]) throw new Error("Unknown bounty winner.");
  const amount = bountyEscrowRaw(bounty);
  if (amount <= 0n) throw new Error(`Bounty ${params.id} has no escrowed reward.`);
  credit(state, params.winnerUserId, amount);
  bounty.status = "paid";
  bounty.winnerUserId = params.winnerUserId;
  bounty.acceptedSubmissionId = params.acceptedSubmissionId;
  bounty.updatedAt = params.updatedAt;
  state.ledger.push({
    id: params.entryId,
    kind: "bounty-payout",
    toUserId: params.winnerUserId,
    amountRaw: amount.toString(),
    chatId: bounty.chatId,
    ref: params.id,
    createdAt: params.updatedAt,
  });
  return bounty;
}

export function applyBountyRefund(
  state: TipBotState,
  params: { id: string; makeEntryId: () => string; status: Extract<TipBotBountyStatus, "cancelled" | "expired" | "disputed">; updatedAt: string },
): TipBotBounty {
  const bounty = findBounty(state, params.id);
  if (!bounty) throw new Error(`Unknown bounty: ${params.id}`);
  if (bounty.status === "paid" || bounty.status === "cancelled" || bounty.status === "expired") {
    throw new Error(`Bounty ${params.id} is ${bounty.status}.`);
  }
  if (params.status === "disputed") {
    bounty.status = "disputed";
    bounty.updatedAt = params.updatedAt;
    return bounty;
  }
  credit(state, bounty.creatorUserId, BigInt(bounty.rewardRaw));
  state.ledger.push({
    id: params.makeEntryId(),
    kind: "bounty-refund",
    toUserId: bounty.creatorUserId,
    amountRaw: bounty.rewardRaw,
    chatId: bounty.chatId,
    ref: bounty.id,
    createdAt: params.updatedAt,
  });
  for (const boost of bounty.boosts) {
    if (boost.refundedAt) continue;
    credit(state, boost.userId, BigInt(boost.amountRaw));
    boost.refundedAt = params.updatedAt;
    state.ledger.push({
      id: params.makeEntryId(),
      kind: "bounty-refund",
      toUserId: boost.userId,
      amountRaw: boost.amountRaw,
      chatId: bounty.chatId,
      ref: bounty.id,
      createdAt: params.updatedAt,
    });
  }
  bounty.status = params.status;
  bounty.updatedAt = params.updatedAt;
  return bounty;
}

export function expireBounties(
  state: TipBotState,
  params: { now: string; makeEntryId: () => string },
): TipBotBounty[] {
  return Object.values(bounties(state))
    .filter((bounty) => bounty.dueAt && bounty.dueAt <= params.now && (bounty.status === "open" || bounty.status === "funding" || bounty.status === "active"))
    .map((bounty) => applyBountyRefund(state, { id: bounty.id, makeEntryId: params.makeEntryId, status: "expired", updatedAt: params.now }));
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

export function findBounty(state: TipBotState, id: string): TipBotBounty | null {
  return bounties(state)[id.toLowerCase()] ?? bounties(state)[id] ?? null;
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
export type TipBotBountyBoardRow = {
  id: string;
  title: string;
  status: TipBotBountyStatus;
  totalRaw: string;
  boostRaw: string;
  boosterCount: number;
  dueAt?: string;
  submissionCount: number;
};

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

export function bountyBoard(
  state: TipBotState,
  params: { chatId?: string; includeClosed?: boolean } = {},
): TipBotBountyBoardRow[] {
  return Object.values(bounties(state))
    .filter((bounty) => !params.chatId || bounty.chatId === params.chatId)
    .filter((bounty) => params.includeClosed || !["paid", "cancelled", "expired"].includes(bounty.status))
    .map((bounty) => {
      const boostRaw = bounty.boosts.reduce((total, boost) => total + (boost.refundedAt ? 0n : BigInt(boost.amountRaw)), 0n);
      const boosters = new Set(bounty.boosts.filter((boost) => !boost.refundedAt).map((boost) => boost.userId));
      return {
        id: bounty.id,
        title: bounty.title,
        status: bounty.status,
        totalRaw: (BigInt(bounty.rewardRaw) + boostRaw).toString(),
        boostRaw: boostRaw.toString(),
        boosterCount: boosters.size,
        dueAt: bounty.dueAt,
        submissionCount: bounty.submissions.length,
      };
    })
    .sort((left, right) => (BigInt(right.totalRaw) > BigInt(left.totalRaw) ? 1 : BigInt(right.totalRaw) < BigInt(left.totalRaw) ? -1 : left.id.localeCompare(right.id)));
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
  for (const bounty of Object.values(bounties(state))) {
    if (bounty.status !== "paid" && bounty.status !== "cancelled" && bounty.status !== "expired") {
      total += bountyEscrowRaw(bounty);
    }
  }
  return total;
}
