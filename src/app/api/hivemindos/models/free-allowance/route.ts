import { readFreeModelAllowance } from "@/lib/services/hivemindos-free-allowance";
import { okJson } from "@/lib/utils/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Last-seen free-tier allowance for the Scout usage meter. The hosted gateway
 * only reports allowance via headers on real completions (querying would spend
 * allowance), so this returns the snapshot recorded by the local gateway proxy
 * — `allowance` is null until the first free call of this install.
 */
export async function GET() {
  return okJson({ allowance: await readFreeModelAllowance() });
}
