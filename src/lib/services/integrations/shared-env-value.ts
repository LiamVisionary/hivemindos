/** Resolve one credential without coupling pure capability checks to env I/O. */
export function sharedEnvValue(key: string, sharedEnv: Record<string, string>) {
  return process.env[key]?.trim() || sharedEnv[key]?.trim() || "";
}
