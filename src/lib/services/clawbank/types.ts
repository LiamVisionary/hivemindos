/**
 * Shared types for the ClawBank integration.
 *
 * ClawBank (https://app.clawbank.co) is a financial + legal OS for AI agents:
 * a self-custody wallet (Base/XRPL), KYC banking rails (Bridge.xyz), off-ramp,
 * autonomous trading, US LLC formation, contracts, comms, and more, exposed
 * over a REST JSON API (`/api/v1/*`) and an MCP JSON-RPC surface (`POST /mcp`).
 *
 * Every REST response uses the envelope `{ "ok": true, "data": {...} }` or
 * `{ "ok": false, "error": { "code": "..." } }`. We normalize both into
 * {@link ClawbankResponse} so callers never have to re-derive success.
 */

/** Normalized result of a ClawBank REST call. `ok` folds in both the HTTP
 *  status and the response envelope's own `ok` flag. */
export type ClawbankResponse<T = unknown> = {
  ok: boolean;
  status: number;
  /** The envelope `data` on success; best-effort `data` (or null) on failure. */
  data: T | null;
  error: string;
  errorCode: string;
  /** The full parsed body, for defensive field probing on shifting shapes. */
  raw: unknown;
};

/** A tool advertised by the ClawBank MCP `tools/list` discovery method. The
 *  per-account catalog is the authoritative source of the live surface — the
 *  REST docs are intentionally partial and defer schema discovery to here. */
export type ClawbankMcpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
};

/** Normalized result of an MCP `tools/call`. ClawBank returns
 *  `{ isError, structuredContent }`; `isError` is checked before success. */
export type ClawbankMcpCallResult = {
  ok: boolean;
  isError: boolean;
  structuredContent: unknown;
  /** Raw `content` blocks (text/json) when present. */
  content: unknown;
  error: string;
  raw: unknown;
};

/** Account readiness flags from `GET /api/v1/me` (`get_me` over MCP). Fields
 *  are optional because the live shape is account- and config-dependent. */
export type ClawbankMe = {
  id?: number | string;
  email?: string;
  bridgeCustomerConfigured?: boolean;
  kycApproved?: boolean;
  tradingEnabled?: boolean;
  wallet?: {
    address?: string;
    chain?: string;
    provisioned?: boolean;
  };
  /** The unmodified `data` object so callers can read fields we don't model. */
  raw: Record<string, unknown>;
};
