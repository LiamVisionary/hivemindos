import type { SocialAccount } from "@/lib/services/socials/socials-types";

/**
 * X-account references are identity/discovery cues only. They do not fetch
 * authored posts, so they cannot establish facts a standalone post may claim.
 */
export function socialAccountHasStandaloneGroundingSource(
  account: Pick<SocialAccount, "contextSources">,
): boolean {
  return account.contextSources.some((source) => source.kind !== "x-account");
}

export function socialStandaloneDraftingSetupMessage(handle: string): string {
  const normalizedHandle = handle.trim().replace(/^@/, "");
  return `Add at least one usable website, GitHub repo, local file, or local folder as a context source for @${normalizedHandle} before generating standalone posts. The posting voice controls style; it is not evidence that this account can claim another account's work.`;
}
