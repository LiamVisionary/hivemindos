export const WALLET_SECRET_EXPORT_CONFIRMATION = "EXPORT_WALLET_SECRET";

export type WalletSecretExportEntry = {
  agentId: string;
  address: string;
  network: string;
  kind: "private-key" | "recovery-phrase";
  secret: string;
};

export function classifyWalletSecret(secret: string): WalletSecretExportEntry["kind"] {
  const normalized = secret.trim();
  if (!normalized.startsWith("0x") && normalized.split(/\s+/).length >= 12) return "recovery-phrase";
  return "private-key";
}

export function dedupeWalletExportEntries(entries: WalletSecretExportEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.kind}:${entry.secret}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function walletSecretExportLabel(entries: WalletSecretExportEntry[]) {
  const kinds = new Set(entries.map((entry) => entry.kind));
  if (kinds.size > 1) return "wallet secret";
  return kinds.has("recovery-phrase") ? "recovery phrase" : "private key";
}

export function renderWalletSecretExport(label: string, entries: WalletSecretExportEntry[]) {
  const lines = [
    "HivemindOS wallet secret export",
    `Wallet: ${label}`,
    `Created: ${new Date().toISOString()}`,
    "",
    "Keep this file offline. Anyone with these secrets can spend from the exported wallets.",
    "",
  ];
  entries.forEach((entry, index) => {
    lines.push(
      `## Wallet ${index + 1}`,
      `Agent id: ${entry.agentId}`,
      `Network: ${entry.network}`,
      `Address: ${entry.address}`,
      `Secret type: ${entry.kind === "recovery-phrase" ? "Recovery phrase" : "Private key"}`,
      "Secret:",
      entry.secret,
      "",
    );
  });
  return `${lines.join("\n")}\n`;
}

export function slugifyWalletExportLabel(label: string) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return slug || "hivemindos";
}
