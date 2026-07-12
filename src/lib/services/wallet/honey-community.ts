import { getHoneyWorkspaceId } from "@/lib/services/wallet/honey-ledger";
import { honeyComputeGatewayUrl } from "@/lib/services/wallet/honey-economy-config";

export type TelegramHoneyLinkResult = {
  linked: true;
  publicLabel: string;
};

export async function linkTelegramHoney(codeInput: string): Promise<TelegramHoneyLinkResult> {
  const code = codeInput.trim();
  if (!/^hny_[a-f0-9]{10}$/i.test(code)) throw new Error("Enter the one-time code from /linkhoney.");
  const workspaceId = await getHoneyWorkspaceId();
  const response = await fetch(`${honeyComputeGatewayUrl()}/community/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, workspaceId }),
    signal: AbortSignal.timeout(8_000),
  });
  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    linked?: boolean;
    publicLabel?: string;
    error?: string;
  } | null;
  if (!response.ok || !data?.ok || !data.linked || !data.publicLabel) {
    const error = new Error(data?.error || `Telegram HONEY link failed (${response.status}).`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return { linked: true, publicLabel: data.publicLabel };
}
