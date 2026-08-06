import type { SocialAccount } from "@/lib/services/socials/socials-types";

export const SOCIAL_X_SESSION_MODE_BINDING = "xSessionMode";
export const SOCIAL_X_AUTH_TOKEN_ENV_BINDING = "env:TWITTER_AUTH_TOKEN";
export const SOCIAL_X_CT0_ENV_BINDING = "env:TWITTER_CT0";

export type SocialXSessionBinding =
  | { mode: "machine-default" }
  | { mode: "account-env"; authTokenEnvKey: string; ct0EnvKey: string };

export function validSocialXSessionEnvKey(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim());
}

export function suggestedSocialXSessionEnvKeys(handle: string): {
  authTokenEnvKey: string;
  ct0EnvKey: string;
} {
  const slug = handle.trim().replace(/^@/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase() || "ACCOUNT";
  return {
    authTokenEnvKey: `SOCIAL_X_${slug}_AUTH_TOKEN`,
    ct0EnvKey: `SOCIAL_X_${slug}_CT0`,
  };
}

export function socialXSessionBinding(
  account: Pick<SocialAccount, "binding">,
): SocialXSessionBinding {
  if (account.binding?.[SOCIAL_X_SESSION_MODE_BINDING] !== "account-env") {
    return { mode: "machine-default" };
  }
  return {
    mode: "account-env",
    authTokenEnvKey: (account.binding[SOCIAL_X_AUTH_TOKEN_ENV_BINDING] ?? "").trim(),
    ct0EnvKey: (account.binding[SOCIAL_X_CT0_ENV_BINDING] ?? "").trim(),
  };
}

export function withSocialXSessionBinding(
  current: Record<string, string> | undefined,
  session: SocialXSessionBinding,
): Record<string, string> | undefined {
  const next = { ...(current ?? {}) };
  delete next[SOCIAL_X_SESSION_MODE_BINDING];
  delete next[SOCIAL_X_AUTH_TOKEN_ENV_BINDING];
  delete next[SOCIAL_X_CT0_ENV_BINDING];
  if (session.mode === "account-env") {
    next[SOCIAL_X_SESSION_MODE_BINDING] = session.mode;
    next[SOCIAL_X_AUTH_TOKEN_ENV_BINDING] = session.authTokenEnvKey;
    next[SOCIAL_X_CT0_ENV_BINDING] = session.ct0EnvKey;
  }
  return Object.keys(next).length ? next : undefined;
}
