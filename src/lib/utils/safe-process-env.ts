const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function cleanProcessEnvValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\0/g, "");
}

export function sanitizeProcessEnv(
  input: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  extra: Record<string, unknown> = {},
): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries({ ...input, ...extra })) {
    if (!ENV_KEY_PATTERN.test(key)) continue;
    const cleaned = cleanProcessEnvValue(value);
    if (cleaned !== undefined) env[key] = cleaned;
  }
  return env;
}
