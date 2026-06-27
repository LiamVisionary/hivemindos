import "server-only";

import { formatUnits } from "viem";
import type { Company } from "@/lib/types/company";
import type { AgentWalletConfig, AgentWalletVaultInfo } from "@/lib/types/agent-wallet";
import type { KanbanBoard, KanbanTask } from "@/lib/types/kanban";
import type { ProgressRewardStakingSummary, ProgressRewardsSnapshot } from "@/lib/types/progress-rewards";
import { isHiveEvmAddress } from "@/lib/config/hive-staking";
import { readCompanies } from "@/lib/services/companies-store";
import {
  createHiveStakingPublicClient,
  getHiveStakeAccountStatus,
  getHiveStakingContractStatus,
  type HiveStakeAccountStatus,
} from "@/lib/services/hive-staking";
import { listBoards, readBoard } from "@/lib/services/kanban/local-kanban-store";
import { readWalletLedger } from "@/lib/services/obsidian/wallet-ledger";
import type { HoneyLedgerEvent } from "@/lib/services/wallet/honey-ledger";
import { readHoneyLedger } from "@/lib/services/wallet/honey-ledger";
import { listWalletInfos } from "@/lib/services/wallet/local-wallet-vault";
import { readSpendLedger, type SpendLedgerRecord } from "@/lib/services/wallet/spend-ledger";
import {
  buildProgressRewardStakingSummary,
  buildProgressRewardsSnapshot,
  type ProgressRewardHoneyEvent,
  type ProgressRewardSpendRecord,
  type ProgressRewardTask,
} from "@/lib/services/progress-rewards-core";

const MAX_STAKING_STATUS_WALLETS = 25;

export type LiveProgressRewardsOptions = {
  now?: number;
  timezoneOffsetMinutes?: number;
};

export async function readProgressRewardsSnapshot(
  options: LiveProgressRewardsOptions = {},
): Promise<ProgressRewardsSnapshot> {
  const [tasks, honeyEvents, spendRecords, companies, staking] = await Promise.all([
    readAllKanbanTasks().catch(() => []),
    readHoneyEvents().catch(() => []),
    readProgressSpendRecords().catch(() => []),
    readProgressCompanies().catch(() => []),
    readProgressStakingSummary().catch(() => buildProgressRewardStakingSummary()),
  ]);

  return buildProgressRewardsSnapshot({
    now: options.now,
    timezoneOffsetMinutes: options.timezoneOffsetMinutes,
    tasks,
    honeyEvents,
    spendRecords,
    companies,
    staking,
  });
}

async function readAllKanbanTasks(): Promise<ProgressRewardTask[]> {
  const metas = await listBoards();
  const slugs = [...new Set((metas.length ? metas : [{ slug: "default" }]).map((meta) => meta.slug))];
  const boards = await Promise.all(slugs.map((slug) => readBoard(slug).catch(() => null)));
  return boards.flatMap((board) => board ? tasksFromBoard(board) : []);
}

function tasksFromBoard(board: KanbanBoard): ProgressRewardTask[] {
  return board.tasks.map((task: KanbanTask) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    assignee: task.assignee,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
    deliverables: task.deliverables,
  }));
}

async function readHoneyEvents(): Promise<ProgressRewardHoneyEvent[]> {
  const ledger = await readHoneyLedger();
  return (ledger.events ?? []).map((event: HoneyLedgerEvent) => ({
    id: event.id,
    agentId: event.agentId,
    agentName: event.agentName,
    kind: event.kind,
    source: event.source,
    tokensUsed: event.tokensUsed,
    honeyDelta: event.honeyDelta,
    hiveDelta: event.hiveDelta,
    createdAt: event.createdAt,
  }));
}

async function readProgressSpendRecords(): Promise<ProgressRewardSpendRecord[]> {
  const records = await readSpendLedger();
  return records.map((record: SpendLedgerRecord) => ({
    id: record.id,
    agentId: record.agentId,
    companyId: record.companyId,
    kind: record.kind,
    amountUsd: record.amountUsd,
    status: record.status,
    createdAtMs: record.createdAtMs,
  }));
}

async function readProgressCompanies(): Promise<Company[]> {
  return readCompanies();
}

async function readProgressStakingSummary(): Promise<ProgressRewardStakingSummary> {
  const addresses = await readPersonalBaseWalletAddresses();
  if (!addresses.length) return buildProgressRewardStakingSummary();

  const client = createHiveStakingPublicClient();
  const contractStatus = await getHiveStakingContractStatus({ client }).catch(() => null);
  const statuses = await Promise.all(addresses.slice(0, MAX_STAKING_STATUS_WALLETS).map((account) => (
    getHiveStakeAccountStatus({ account, client }).catch(() => null)
  )));
  const readableStatuses = statuses.filter((status): status is HiveStakeAccountStatus => Boolean(status));
  const totalStakedHive = readableStatuses.reduce((total, status) => total + Number(formatUnits(status.activeStakedRaw, 18)), 0);
  const pendingUnstakeHive = readableStatuses.reduce((total, status) => total + Number(formatUnits(status.pendingUnstakeRaw, 18)), 0);

  return buildProgressRewardStakingSummary({
    walletCount: addresses.length,
    checkedWalletCount: readableStatuses.length,
    totalStakedHive,
    pendingUnstakeHive,
    paused: Boolean(contractStatus?.paused),
    cooldownSeconds: contractStatus ? Number(contractStatus.cooldown) : undefined,
  });
}

async function readPersonalBaseWalletAddresses(): Promise<string[]> {
  const [ledger, vaultWallets] = await Promise.all([
    readWalletLedger(),
    listWalletInfos({ agentIdPrefix: "user:" }).catch(() => []),
  ]);
  const addresses = new Set<string>();
  for (const record of ledger.records) {
    if (!record.agentId.startsWith("user:")) continue;
    addPersonalBaseWalletAddress(addresses, record.wallet);
  }
  for (const wallet of vaultWallets) {
    addPersonalBaseVaultAddress(addresses, wallet);
  }
  return [...addresses];
}

function addPersonalBaseWalletAddress(addresses: Set<string>, wallet: AgentWalletConfig) {
  if (wallet.network !== "eip155:8453") return;
  const address = wallet.walletAddress || wallet.vaultAddress || "";
  if (isHiveEvmAddress(address)) addresses.add(address.toLowerCase());
}

function addPersonalBaseVaultAddress(addresses: Set<string>, wallet: AgentWalletVaultInfo) {
  if (wallet.network !== "eip155:8453") return;
  if (isHiveEvmAddress(wallet.address)) addresses.add(wallet.address.toLowerCase());
}
