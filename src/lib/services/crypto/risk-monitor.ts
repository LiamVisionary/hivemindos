import "server-only";

import type { AgentWalletConfig } from "@/lib/types/agent-wallet";
import type { AgentIdentityRecord } from "@/lib/services/crypto/agent-identity-registry";
import { hiveEnvPresence } from "@/lib/services/shared-hive-env";

export type CryptoRiskSeverity = "info" | "low" | "medium" | "high" | "critical";
export type CryptoRiskCategory = "wallet" | "identity" | "env" | "infra" | "repo" | "dns" | "multisig" | "policy";

export type CryptoRiskFinding = {
  category: CryptoRiskCategory;
  severity: CryptoRiskSeverity;
  code: string;
  title: string;
  detail: string;
  recommendation: string;
};

export type CryptoRiskSubject = {
  agentId?: string;
  wallet?: Partial<AgentWalletConfig>;
  identity?: Partial<AgentIdentityRecord>;
  env?: {
    requiredKeys?: string[];
    optionalKeys?: string[];
  };
  repo?: {
    githubRepo?: string;
    defaultBranchProtected?: boolean;
    requiredReviewCount?: number;
    dependencyAuditClean?: boolean;
    hasSecurityPolicy?: boolean;
    deployKeyScoped?: boolean;
  };
  dns?: Array<{
    domain: string;
    dnssec?: boolean;
    registrarLock?: boolean;
    expiryDays?: number;
  }>;
  multisig?: {
    threshold?: number;
    signerCount?: number;
    hardwareSignerCount?: number;
    recoveryDocumented?: boolean;
  };
  infrastructure?: {
    publicEndpoints?: string[];
    tailnetOnly?: boolean;
    webhookSecretsConfigured?: boolean;
    runtimeMutationRequiresApproval?: boolean;
  };
};

export type CryptoRiskReport = {
  generatedAt: string;
  agentId?: string;
  score: number;
  severity: CryptoRiskSeverity;
  findings: CryptoRiskFinding[];
  recommendedActions: string[];
};

const DEFAULT_REQUIRED_ENV_KEYS = ["VEIL_KEY", "HIVE_TOKEN_ADDRESS"] as const;
const SEVERITY_PENALTY: Record<CryptoRiskSeverity, number> = {
  info: 0,
  low: 4,
  medium: 10,
  high: 20,
  critical: 35,
};

export async function evaluateCryptoRisk(subject: CryptoRiskSubject = {}): Promise<CryptoRiskReport> {
  const findings: CryptoRiskFinding[] = [
    ...walletFindings(subject.wallet),
    ...identityFindings(subject.identity),
    ...infrastructureFindings(subject.infrastructure),
    ...repoFindings(subject.repo),
    ...dnsFindings(subject.dns ?? []),
    ...multisigFindings(subject.multisig),
  ];
  findings.push(...await envFindings(subject.env));
  if (findings.length === 0) {
    findings.push({
      category: "policy",
      severity: "info",
      code: "no-risks-detected",
      title: "No obvious crypto control gaps supplied",
      detail: "The submitted subject did not expose a known gap in this offline review.",
      recommendation: "Keep running provider-specific readiness checks before enabling new spend rails.",
    });
  }
  const score = Math.max(0, 100 - findings.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0));
  return {
    generatedAt: new Date().toISOString(),
    agentId: subject.agentId ?? subject.wallet?.agentId ?? subject.identity?.agentId,
    score,
    severity: reportSeverity(score, findings),
    findings,
    recommendedActions: [...new Set(findings
      .filter((finding) => finding.severity !== "info")
      .map((finding) => finding.recommendation))],
  };
}

function walletFindings(wallet?: Partial<AgentWalletConfig>): CryptoRiskFinding[] {
  if (!wallet) {
    return [{
      category: "wallet",
      severity: "medium",
      code: "wallet-policy-missing",
      title: "Wallet policy was not supplied",
      detail: "The monitor could not inspect spend caps, auto-use, network, or provider selection.",
      recommendation: "Attach the agent wallet policy before enabling paid API, transfer, trade, or private-payment actions.",
    }];
  }
  const findings: CryptoRiskFinding[] = [];
  if (wallet.enabled && wallet.autoPayEnabled && (!Number.isFinite(Number(wallet.maxPaymentUsd)) || Number(wallet.maxPaymentUsd) <= 0)) {
    findings.push({
      category: "wallet",
      severity: "critical",
      code: "autopay-without-cap",
      title: "Auto-use is enabled without a hard per-payment cap",
      detail: "A wallet that can spend automatically needs a nonzero maxPaymentUsd guard.",
      recommendation: "Set maxPaymentUsd before enabling wallet auto-use.",
    });
  }
  if (wallet.enabled && !wallet.dailyBudgetUsd) {
    findings.push({
      category: "wallet",
      severity: "medium",
      code: "daily-budget-missing",
      title: "No rolling daily spend budget",
      detail: "Per-payment caps do not prevent many small spends from draining a wallet.",
      recommendation: "Set a rolling dailyBudgetUsd for production or long-running agents.",
    });
  }
  if (wallet.provider === "veil" && wallet.veilAutoSendEnabled && !wallet.assetSpendCaps?.USDC && !wallet.assetSpendCaps?.ETH) {
    findings.push({
      category: "wallet",
      severity: "high",
      code: "veil-auto-send-without-asset-cap",
      title: "Veil auto-send lacks asset caps",
      detail: "Private sends can execute without a provider token only when explicit per-asset caps constrain them.",
      recommendation: "Set USDC and/or ETH asset spend caps before enabling Veil auto-send.",
    });
  }
  if (!wallet.network) {
    findings.push({
      category: "wallet",
      severity: "low",
      code: "network-missing",
      title: "Wallet network is not declared",
      detail: "Network-less wallet metadata makes clear-signing and payment-requirement matching weaker.",
      recommendation: "Store a CAIP-2 network such as eip155:8453 or solana:mainnet with the wallet policy.",
    });
  }
  return findings;
}

function identityFindings(identity?: Partial<AgentIdentityRecord>): CryptoRiskFinding[] {
  if (!identity) {
    return [{
      category: "identity",
      severity: "medium",
      code: "identity-missing",
      title: "Agent identity record is missing",
      detail: "External marketplaces and paid endpoints need a stable identity/listing before users can verify the counterparty.",
      recommendation: "Register a local agent identity with wallet, ENS/ERC-8004 metadata, endpoint, and advertised capabilities.",
    }];
  }
  const findings: CryptoRiskFinding[] = [];
  if (!identity.walletAddress && !identity.ensName && !identity.erc8004EntityId) {
    findings.push({
      category: "identity",
      severity: "medium",
      code: "identity-unanchored",
      title: "Agent identity is not anchored",
      detail: "The identity has no wallet address, ENS name, or ERC-8004 entity id.",
      recommendation: "Add at least one verifiable identity anchor before publishing the listing.",
    });
  }
  if (!identity.x402Endpoint && !identity.serviceEndpoint) {
    findings.push({
      category: "identity",
      severity: "low",
      code: "identity-no-endpoint",
      title: "Agent identity has no service endpoint",
      detail: "A listing without an endpoint cannot be used as an agent reachability record.",
      recommendation: "Add a serviceEndpoint or x402Endpoint once the public service is ready.",
    });
  }
  if ((identity.capabilities ?? []).length === 0) {
    findings.push({
      category: "identity",
      severity: "low",
      code: "identity-no-capabilities",
      title: "Agent identity advertises no capabilities",
      detail: "Capability-free listings are hard for routers and marketplaces to match.",
      recommendation: "Advertise concise capability strings such as paid-api, research, trading, or private-payment.",
    });
  }
  return findings;
}

async function envFindings(env?: CryptoRiskSubject["env"]): Promise<CryptoRiskFinding[]> {
  const required = sanitizeEnvKeys(env?.requiredKeys?.length ? env.requiredKeys : DEFAULT_REQUIRED_ENV_KEYS);
  const optional = sanitizeEnvKeys(env?.optionalKeys ?? []);
  const presence = await hiveEnvPresence([...required, ...optional]);
  return presence.flatMap((item) => {
    if (item.present || !required.includes(item.key)) return [];
    return [{
      category: "env" as const,
      severity: "medium" as const,
      code: "required-env-missing",
      title: `${item.key} is not configured`,
      detail: "The key was checked by name only and is missing from process/shared hive env.",
      recommendation: `Add ${item.key} through hive-env-add before relying on the corresponding crypto rail.`,
    }];
  });
}

function infrastructureFindings(infra?: CryptoRiskSubject["infrastructure"]): CryptoRiskFinding[] {
  if (!infra) return [];
  const findings: CryptoRiskFinding[] = [];
  for (const endpoint of infra.publicEndpoints ?? []) {
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "https:" && !isLocalHost(parsed.hostname)) {
        findings.push({
          category: "infra",
          severity: "high",
          code: "public-endpoint-not-https",
          title: "Public endpoint is not HTTPS",
          detail: `${parsed.host} is exposed over ${parsed.protocol}.`,
          recommendation: "Serve public crypto/payment endpoints over HTTPS only.",
        });
      }
    } catch {
      findings.push({
        category: "infra",
        severity: "medium",
        code: "endpoint-invalid",
        title: "Endpoint URL is invalid",
        detail: endpoint,
        recommendation: "Fix or remove invalid endpoint metadata before publishing identity records.",
      });
    }
  }
  if (infra.tailnetOnly === false) {
    findings.push({
      category: "infra",
      severity: "medium",
      code: "not-tailnet-only",
      title: "Infrastructure is not Tailnet-only",
      detail: "Local collectors or mutation endpoints should remain private unless explicitly designed for public exposure.",
      recommendation: "Keep collectors private to Tailscale/Hivemind Link and expose only audited public service endpoints.",
    });
  }
  if (infra.webhookSecretsConfigured === false) {
    findings.push({
      category: "infra",
      severity: "high",
      code: "webhook-secret-missing",
      title: "Webhook signing secret is missing",
      detail: "Settlement or funding webhooks without signature checks can create false credits.",
      recommendation: "Configure provider webhook signing secrets before accepting funding or settlement events.",
    });
  }
  if (infra.runtimeMutationRequiresApproval === false) {
    findings.push({
      category: "infra",
      severity: "high",
      code: "runtime-mutation-unguarded",
      title: "Runtime mutation is not approval-gated",
      detail: "Remote runtime mutation can affect agents that hold payment capabilities.",
      recommendation: "Gate runtime mutation/update endpoints behind explicit design and approval checks.",
    });
  }
  return findings;
}

function repoFindings(repo?: CryptoRiskSubject["repo"]): CryptoRiskFinding[] {
  if (!repo) return [];
  const findings: CryptoRiskFinding[] = [];
  if (repo.defaultBranchProtected === false) {
    findings.push({
      category: "repo",
      severity: "high",
      code: "branch-protection-missing",
      title: "Default branch is not protected",
      detail: repo.githubRepo ? `${repo.githubRepo} can change without branch protection.` : "The default branch can change without branch protection.",
      recommendation: "Enable branch protection and required checks for repositories that deploy payment or identity surfaces.",
    });
  }
  if ((repo.requiredReviewCount ?? 0) < 1) {
    findings.push({
      category: "repo",
      severity: "medium",
      code: "review-missing",
      title: "Code review requirement is missing",
      detail: "Payment and identity routes should not be mergeable without review.",
      recommendation: "Require at least one approving review for crypto control-plane code.",
    });
  }
  if (repo.dependencyAuditClean === false) {
    findings.push({
      category: "repo",
      severity: "medium",
      code: "dependency-audit-not-clean",
      title: "Dependency audit is not clean",
      detail: "Known vulnerable dependencies can become signing, routing, or payment risk.",
      recommendation: "Run and clear dependency audit findings before production exposure.",
    });
  }
  if (repo.hasSecurityPolicy === false) {
    findings.push({
      category: "repo",
      severity: "low",
      code: "security-policy-missing",
      title: "Security policy is missing",
      detail: "Researchers and operators need a clear reporting path for crypto/payment bugs.",
      recommendation: "Publish SECURITY.md or equivalent reporting guidance.",
    });
  }
  if (repo.deployKeyScoped === false) {
    findings.push({
      category: "repo",
      severity: "high",
      code: "deploy-key-overbroad",
      title: "Deploy credential scope is too broad",
      detail: "Broad deploy credentials increase blast radius if an agent or CI job is compromised.",
      recommendation: "Use repo-scoped, least-privilege deploy credentials.",
    });
  }
  return findings;
}

function dnsFindings(domains: NonNullable<CryptoRiskSubject["dns"]>): CryptoRiskFinding[] {
  return domains.flatMap((domain) => {
    const findings: CryptoRiskFinding[] = [];
    if (domain.registrarLock === false) {
      findings.push({
        category: "dns",
        severity: "high",
        code: "registrar-lock-missing",
        title: "Registrar lock is off",
        detail: `${domain.domain} can be easier to hijack without registrar lock.`,
        recommendation: "Enable registrar lock for domains serving payment, identity, or x402 endpoints.",
      });
    }
    if (domain.dnssec === false) {
      findings.push({
        category: "dns",
        severity: "low",
        code: "dnssec-missing",
        title: "DNSSEC is not enabled",
        detail: `${domain.domain} does not report DNSSEC in the supplied status.`,
        recommendation: "Enable DNSSEC where the registrar and DNS provider support it.",
      });
    }
    if (domain.expiryDays != null && domain.expiryDays < 30) {
      findings.push({
        category: "dns",
        severity: "medium",
        code: "domain-expiring",
        title: "Domain expires soon",
        detail: `${domain.domain} expires in ${domain.expiryDays} days.`,
        recommendation: "Renew the domain before exposing payment or identity endpoints.",
      });
    }
    return findings;
  });
}

function multisigFindings(multisig?: CryptoRiskSubject["multisig"]): CryptoRiskFinding[] {
  if (!multisig) return [];
  const findings: CryptoRiskFinding[] = [];
  const threshold = Number(multisig.threshold ?? 0);
  const signerCount = Number(multisig.signerCount ?? 0);
  if (threshold < 2 || signerCount < 3) {
    findings.push({
      category: "multisig",
      severity: "high",
      code: "multisig-too-small",
      title: "Multisig threshold/signers are too small",
      detail: `Threshold ${threshold || "unknown"} of ${signerCount || "unknown"} signers was supplied.`,
      recommendation: "Use a threshold of at least 2 with at least 3 independent signers for treasury or production admin controls.",
    });
  }
  if ((multisig.hardwareSignerCount ?? 0) < 1) {
    findings.push({
      category: "multisig",
      severity: "medium",
      code: "hardware-signer-missing",
      title: "No hardware signer recorded",
      detail: "A multisig without hardware-backed signers has weaker key custody.",
      recommendation: "Add at least one hardware-backed signer for production admin or treasury wallets.",
    });
  }
  if (multisig.recoveryDocumented === false) {
    findings.push({
      category: "multisig",
      severity: "medium",
      code: "recovery-undocumented",
      title: "Recovery process is undocumented",
      detail: "Signer loss or emergency rotation needs a reviewed recovery runbook.",
      recommendation: "Document signer recovery and rotation before storing meaningful treasury value.",
    });
  }
  return findings;
}

function reportSeverity(score: number, findings: CryptoRiskFinding[]): CryptoRiskSeverity {
  if (findings.some((finding) => finding.severity === "critical") || score < 35) return "critical";
  if (findings.some((finding) => finding.severity === "high") || score < 65) return "high";
  if (findings.some((finding) => finding.severity === "medium") || score < 82) return "medium";
  if (findings.some((finding) => finding.severity === "low") || score < 95) return "low";
  return "info";
}

function sanitizeEnvKeys(keys: readonly string[]) {
  return [...new Set(keys.map((key) => key.trim()).filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key)))];
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}
