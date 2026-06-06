import type { AgentSpendCapAsset } from "@/lib/types/agent-wallet";

export type ProviderCopy = { label: string; summary: string; setup: string };

export type WalletActionState = {
  busy?: boolean;
  sendTo?: string;
  sendAmount?: string;
  sendAsset?: AgentSpendCapAsset;
  confirmation?: string;
  x402Url?: string;
  x402Method?: string;
  x402Confirmation?: string;
  message?: string;
  error?: string;
};

export type MoneyClawStatus = {
  configured: boolean;
  apiKeyEnvName: string;
  balance?: unknown;
  depositAddress?: unknown;
  paymentIntents?: unknown;
  errors?: Record<string, string>;
};

export type MoneyClawSaveOptions = { shareWithAllAgents: boolean };
