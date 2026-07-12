// Wallet -> workspace link for stake-tier Honey multipliers.
//
// The staking wallet signs the compute gateway's single-use nonce message
// (EIP-191) and the gateway verifies it server-side before granting the boost —
// the link is never client-asserted, per the commercial trust boundary. The
// wallet key comes from the local wallet vault, so this flow covers staking
// wallets imported into HivemindOS; linking an external browser wallet (sign in
// the /stake page style) is a documented follow-up.
//
// The link is also recorded locally (honey-staking-multiplier.ts) so the local
// kill-switch-off ledger mirrors the same multiplier semantics immediately,
// even when the hosted economy is dark or unreachable.

import { getHoneyWorkspaceId } from "@/lib/services/wallet/honey-ledger";
import { honeyComputeGatewayUrl } from "@/lib/services/wallet/honey-economy-config";
import { isHiveEvmAddress } from "@/lib/config/hive-staking";
import { listWalletInfos, getWalletSecret } from "@/lib/services/wallet/local-wallet-vault";
import { resolveEvmSigningAccount } from "@/lib/services/wallet/chain-wallet";
import {
  readHoneyWalletLink,
  resolveLocalHoneyMultiplier,
  writeHoneyWalletLink,
  type HoneyWalletLinkCache,
} from "@/lib/services/wallet/honey-staking-multiplier";

const GATEWAY_TIMEOUT_MS = 8_000;

export type HoneyWalletLinkResult = {
  address: string;
  gatewayLinked: boolean;
  gatewayError?: string;
  multiplier: HoneyWalletLinkCache & { address: string | null };
};

export async function linkHoneyWallet(addressInput: string): Promise<HoneyWalletLinkResult> {
  const address = addressInput.trim().toLowerCase();
  if (!isHiveEvmAddress(address)) throw new Error("A valid 0x wallet address is required.");

  const infos = await listWalletInfos();
  const record = infos.find((info) => info.network.startsWith("eip155") && info.address.toLowerCase() === address);
  if (!record) {
    throw new Error("No vault wallet holds this address. Import the staking wallet first (Wallet -> Import), or link an external wallet from the /stake page flow when available.");
  }
  const stored = await getWalletSecret(record.agentId);
  if (!stored) throw new Error("The vault wallet secret could not be read.");
  const account = resolveEvmSigningAccount(stored.secret, address);

  const workspaceId = await getHoneyWorkspaceId();
  const gateway = await linkAtGateway(workspaceId, address, (message) => account.signMessage({ message }));

  await writeHoneyWalletLink({
    address,
    linkedAt: new Date().toISOString(),
    gatewayLinked: gateway.linked,
  });
  const multiplier = await resolveLocalHoneyMultiplier();
  return {
    address,
    gatewayLinked: gateway.linked,
    ...(gateway.error ? { gatewayError: gateway.error } : {}),
    multiplier,
  };
}

export async function honeyWalletLinkStatus(): Promise<{
  linked: boolean;
  address: string | null;
  gatewayLinked: boolean;
  multiplier: HoneyWalletLinkCache & { address: string | null };
}> {
  const link = await readHoneyWalletLink();
  const multiplier = await resolveLocalHoneyMultiplier();
  return {
    linked: Boolean(link),
    address: link?.address ?? null,
    gatewayLinked: link?.gatewayLinked === true,
    multiplier,
  };
}

// Best effort: a dark or unreachable gateway must not block the local link, but
// a real verification refusal (4xx) is surfaced so the caller can see why the
// OFFICIAL boost was not granted.
async function linkAtGateway(
  workspaceId: string,
  address: string,
  sign: (message: string) => Promise<string>,
): Promise<{ linked: boolean; error?: string }> {
  const base = honeyComputeGatewayUrl();
  try {
    const nonceResponse = await fetch(`${base}/honey/wallet-link/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, address }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    const nonceData = await nonceResponse.json().catch(() => null) as { ok?: boolean; nonce?: string; message?: string; error?: string } | null;
    if (!nonceResponse.ok || !nonceData?.ok || !nonceData.nonce || !nonceData.message) {
      return { linked: false, error: nonceData?.error || `Gateway nonce request failed (${nonceResponse.status}).` };
    }

    const signature = await sign(nonceData.message);
    const linkResponse = await fetch(`${base}/honey/wallet-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, address, nonce: nonceData.nonce, signature }),
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    const linkData = await linkResponse.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    if (!linkResponse.ok || !linkData?.ok) {
      return { linked: false, error: linkData?.error || `Gateway wallet link failed (${linkResponse.status}).` };
    }
    return { linked: true };
  } catch {
    return { linked: false, error: "The compute gateway is unreachable; the wallet is linked locally and the official link can be retried later." };
  }
}
