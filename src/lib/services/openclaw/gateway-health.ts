import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from '@/lib/home-dir';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

async function readConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Read the gateway auth token from openclaw.json.
 * Falls back to the provided token if config can't be read.
 */
export async function getGatewayAuthToken(fallback?: string): Promise<string> {
  try {
    const config = await readConfig();
    const gw = (config.gateway ?? {}) as Record<string, unknown>;
    const auth = (gw.auth ?? {}) as Record<string, unknown>;
    const configToken = auth.token as string | undefined;
    if (configToken && configToken.length > 0) return configToken;
  } catch { /* non-fatal */ }
  return fallback ?? '';
}
