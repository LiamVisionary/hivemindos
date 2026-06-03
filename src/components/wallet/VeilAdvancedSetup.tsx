"use client";

import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  Check,
  Coins,
  Copy,
  Globe,
  KeyRound,
  Layers,
  Lock,
  RefreshCcw,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AgentPaymentProvider } from "@/lib/types/agent-wallet";
import { cn } from "@/lib/utils/cn";

import walletStyles from "./AgentWalletCard.module.css";
import styles from "./VeilAdvancedSetup.module.css";

type ProviderCopy = { label: string; summary: string; setup: string };

export type VeilContract = {
  key: string;
  label: string;
  value: string;
  kind?: "entry" | "usdc" | "eth" | "relay";
};

export type VeilSetupStatus = {
  cliInstalled?: boolean;
  cliPath?: string;
  mcpInstalled?: boolean;
  mcpPath?: string;
  mcpVersion?: string;
  mcpMinimumVersion?: string;
  mcpMeetsMinimum?: boolean;
  veilKeyConfigured?: boolean;
  depositKeyConfigured?: boolean;
  mode?: string;
};

export type VeilSetupAction = "checking" | "setting" | null;

export type VeilAdvancedSetupProps = {
  signerAddress: string;
  networkLabel: string;
  assetsLabel: string;
  provider: AgentPaymentProvider;
  providerOptions: Array<[AgentPaymentProvider, ProviderCopy]>;
  providerCopy: ProviderCopy;
  contracts: VeilContract[];
  setupStatus: VeilSetupStatus | null;
  setupAction: VeilSetupAction;
  setupMessage: string;
  onChangeProvider: (provider: AgentPaymentProvider) => void;
  onChangeSignerAddress: (address: string) => void;
  onCheckSetup: () => Promise<void> | void;
  onSetupVeil: () => Promise<void> | void;
  onCopyPrompt: () => void;
  onOpenWallet: () => void;
  onOpenDocs: () => void;
  onCopyCli: () => void;
};

const HEX_POINTS = "50,3 91,26 91,74 50,97 9,74 9,26";

function shortAddress(value: string): string {
  if (!value) return "";
  if (value.length <= 16) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function contractIcon(kind?: VeilContract["kind"]) {
  if (kind === "usdc") return <Coins aria-hidden="true" />;
  if (kind === "eth") return <Layers aria-hidden="true" />;
  if (kind === "relay") return <Globe aria-hidden="true" />;
  return <Boxes aria-hidden="true" />;
}

function methodIcon(value: string) {
  if (/veil/i.test(value)) return <ShieldCheck aria-hidden="true" />;
  if (/usepod/i.test(value)) return <Coins aria-hidden="true" />;
  if (/x402/i.test(value)) return <ArrowUpRight aria-hidden="true" />;
  return <KeyRound aria-hidden="true" />;
}

function methodLabel(value: string, fallback: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("veil")) return "Veil";
  if (normalized.includes("usepod")) return "UsePod";
  if (normalized.includes("x402")) return "x402";
  if (normalized.includes("claw") || normalized.includes("card")) return "Card";
  if (normalized.includes("crypto") || normalized.includes("wallet")) return "Crypto";
  if (normalized.includes("trad")) return "Trade";
  return fallback.split(/\s+/)[0];
}

function statusState(value: boolean | undefined, checked: boolean): "ok" | "idle" {
  return checked && value ? "ok" : "idle";
}

function statusValue(value: boolean | undefined, checked: boolean, okLabel: string, emptyLabel: string): string {
  if (!checked) return "Not checked";
  return value ? okLabel : emptyLabel;
}

export function VeilAdvancedSetup({
  signerAddress,
  networkLabel,
  assetsLabel,
  provider,
  providerOptions,
  providerCopy,
  contracts,
  setupStatus,
  setupAction,
  setupMessage,
  onChangeProvider,
  onChangeSignerAddress,
  onCheckSetup,
  onSetupVeil,
  onCopyPrompt,
  onOpenWallet,
  onOpenDocs,
  onCopyCli,
}: VeilAdvancedSetupProps) {
  const checked = Boolean(setupStatus);
  const checking = setupAction === "checking";
  const setting = setupAction === "setting";
  const mcpReady = Boolean(setupStatus?.mcpInstalled && setupStatus.mcpMeetsMinimum !== false);
  const ready = Boolean(setupStatus?.cliInstalled && mcpReady && setupStatus.veilKeyConfigured && setupStatus.depositKeyConfigured);
  const mcpStatusLabel = setupStatus?.mcpInstalled && setupStatus.mcpMeetsMinimum === false
    ? `Upgrade needed${setupStatus.mcpVersion ? ` (${setupStatus.mcpVersion})` : ""}`
    : statusValue(setupStatus?.mcpInstalled, checked, "Installed", "Not installed");
  const operatorState = setting ? "pending" : statusState(setupStatus?.veilKeyConfigured, checked);
  const depositState = setting ? "pending" : statusState(setupStatus?.depositKeyConfigured, checked);

  return (
    <>
      <div className={walletStyles.sheetField}>
        <span className={walletStyles.fieldLabel}>Payment method</span>
        <div className={styles.veilMethods} role="radiogroup" aria-label="Payment method">
          {providerOptions.map(([value, copy]) => {
            const active = value === provider;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                title={copy.label}
                className={cn(styles.veilMethod, active && styles.veilMethodActive)}
                onClick={() => onChangeProvider(value)}
              >
                <span className={styles.veilMethodIcon}>{methodIcon(value)}</span>
                <span className={styles.veilMethodBody}><b>{methodLabel(value, copy.label)}</b></span>
                <span className={styles.veilMethodCheck}><Check aria-hidden="true" /></span>
              </button>
            );
          })}
        </div>
        <p className={walletStyles.sheetHelp}>{providerCopy.summary}</p>
      </div>

      <div className={walletStyles.sheetField}>
        <label htmlFor="wallet-veil-signer">Base signer address</label>
        <input
          id="wallet-veil-signer"
          value={signerAddress}
          onChange={(event) => onChangeSignerAddress(event.target.value)}
          placeholder="Base 0x signer address"
        />
        {signerAddress ? (
          <p className={walletStyles.sheetStatus} data-tone="muted">Public signer: {shortAddress(signerAddress)}</p>
        ) : (
          <p className={walletStyles.sheetStatus} data-tone="muted">Not connected</p>
        )}
      </div>

      <div className={walletStyles.sheetGrid}>
        <div className={walletStyles.sheetField}>
          <span className={walletStyles.fieldLabel}>Network</span>
          <div className={walletStyles.readOnlyField}>{networkLabel}</div>
        </div>
        <div className={walletStyles.sheetField}>
          <span className={walletStyles.fieldLabel}>Assets</span>
          <div className={walletStyles.readOnlyField}>{assetsLabel}</div>
        </div>
      </div>

      <div className={walletStyles.sheetField}>
        <span className={walletStyles.fieldLabel}>Veil Cash setup</span>
        <div className={styles.veilHero}>
          <span className={styles.veilShield}>
            <span className={styles.veilRing} />
            <span className={styles.veilRing} data-d="2" />
            <span className={styles.veilShieldHex}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <polygon points={HEX_POINTS} fill="rgba(167,139,250,0.12)" />
                <polygon points={HEX_POINTS} fill="none" stroke="rgba(167,139,250,0.7)" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
              {ready ? <ShieldCheck aria-hidden="true" /> : <Lock aria-hidden="true" />}
            </span>
          </span>
          <div className={styles.veilHeroText}>
            <strong>Base privacy pools with explicit registration, proof, and relay</strong>
            <p>HivemindOS keeps one workspace operator key, then uses the configured Base signer and Veil queues for reviewed private sends.</p>
          </div>
        </div>
      </div>

      <div className={styles.veilStatGrid}>
        <div className={styles.veilStat} data-state={statusState(setupStatus?.cliInstalled, checked)}>
          <div className={styles.veilStatHead}><span>Veil CLI</span><span className={styles.veilPin} /></div>
          <strong>{statusValue(setupStatus?.cliInstalled, checked, "Installed", "Not installed")}</strong>
        </div>
        <div className={styles.veilStat} data-state={statusState(mcpReady, checked)}>
          <div className={styles.veilStatHead}><span>Veil MCP</span><span className={styles.veilPin} /></div>
          <strong>{mcpStatusLabel}</strong>
        </div>
        <div className={styles.veilStat} data-state={operatorState}>
          <div className={styles.veilStatHead}><span>Operator key</span><span className={styles.veilPin} /></div>
          <strong>{setting ? "Configuring..." : statusValue(setupStatus?.veilKeyConfigured, checked, "Configured", "Not configured")}</strong>
        </div>
        <div className={styles.veilStat} data-state={depositState}>
          <div className={styles.veilStatHead}><span>Deposit key</span><span className={styles.veilPin} /></div>
          <strong>{setting ? "Configuring..." : statusValue(setupStatus?.depositKeyConfigured, checked, "Configured", "Not configured")}</strong>
        </div>
      </div>

      <div className={styles.veilActions}>
        <Button type="button" size="sm" variant="secondary" isLoading={checking} disabled={setting} onClick={() => void onCheckSetup()}>
          {checking ? null : <RefreshCcw aria-hidden="true" />}
          Check setup
        </Button>
        <Button type="button" size="sm" isLoading={setting} onClick={() => void onSetupVeil()}>
          {setting ? null : <KeyRound aria-hidden="true" />}
          {ready ? "Re-run setup" : "Setup Veil"}
        </Button>
      </div>

      {setting ? (
        <div className={styles.veilProgress}>
          <div className={styles.veilProgressTitle}><ShieldCheck aria-hidden="true" /> Setting up Veil</div>
          <div className={styles.veilProgressRow} data-state="done"><Check aria-hidden="true" /> Installing or locating Veil CLI and MCP</div>
          <div className={styles.veilProgressRow} data-state="active"><RefreshCcw className={styles.veilSpin} aria-hidden="true" /> Generating workspace operator keys</div>
          <div className={styles.veilProgressRow} data-state="idle"><Lock aria-hidden="true" /> Saving keys through HivemindOS env</div>
        </div>
      ) : null}

      {setupMessage ? (
        <p className={walletStyles.sheetStatus} data-tone={setupMessage.startsWith("Could not") || setupMessage.includes("not installed") ? "error" : ready ? "ok" : "muted"}>
          {setupMessage}
        </p>
      ) : null}

      {ready ? (
        <div className={walletStyles.sheetField}>
          <span className={styles.veilSectionLabel}><ShieldCheck aria-hidden="true" /> Pool contracts · Base</span>
          <div className={styles.veilContracts}>
            {contracts.map((contract, index) => (
              <div
                key={contract.key}
                className={styles.veilAddr}
                data-relay={contract.kind === "relay" ? "true" : undefined}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className={styles.veilAddrHead}><span>{contract.label}</span>{contractIcon(contract.kind)}</div>
                <code>{contract.value}</code>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={walletStyles.sheetButtons}>
        <Button type="button" size="sm" variant="secondary" onClick={onOpenWallet}>
          <ArrowUpRight aria-hidden="true" />
          Open wallet
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onOpenDocs}>
          <BookOpen aria-hidden="true" />
          Open docs
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCopyCli}>
          <TerminalSquare aria-hidden="true" />
          Copy CLI
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCopyPrompt}>
          <Copy aria-hidden="true" />
          Copy prompt
        </Button>
      </div>

      <p className={walletStyles.sheetStatus} data-tone={ready ? "ok" : "muted"}>{providerCopy.setup}</p>
    </>
  );
}
