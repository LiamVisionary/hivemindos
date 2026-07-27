import { connectorManifest } from "@/lib/services/integrations/connector-manifests";
import type { ConnectionProviderKey } from "@/lib/types/integrations";

const DEFAULT_FIELDS: Partial<Record<ConnectionProviderKey, Record<string, string>>> = {
  plausible: { baseUrl: "https://plausible.io" },
  calcom: { baseUrl: "https://api.cal.com/v2" },
  medusa: { baseUrl: "http://127.0.0.1:9000" },
};

function normalizedHttpOrigin(value: string, label: string, allowPath: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid http or https URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must use http or https.`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} cannot contain credentials, a query, or a fragment.`);
  if (!allowPath && url.pathname !== "/") throw new Error(`${label} must be an origin without a path.`);
  return `${url.origin}${allowPath ? url.pathname.replace(/\/+$/, "") : ""}`;
}

function normalizeShopDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  const host = /^https?:\/\//.test(trimmed)
    ? normalizedHttpOrigin(trimmed, "Shop domain", false).replace(/^https?:\/\//, "")
    : trimmed.replace(/\/+$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    throw new Error("Shop domain must be the permanent *.myshopify.com domain.");
  }
  return host;
}

export function normalizeProviderSetupFields(
  providerKey: ConnectionProviderKey,
  input: unknown,
): Record<string, string> {
  const manifest = connectorManifest(providerKey);
  const definitions = manifest?.auth.setupFields ?? [];
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const defaults = DEFAULT_FIELDS[providerKey] ?? {};
  const values: Record<string, string> = {};
  for (const field of definitions) {
    const rawValue = raw[field.id];
    const supplied = typeof rawValue === "string" ? rawValue.trim() : "";
    const value = supplied || defaults[field.id] || "";
    if (field.required && !value) throw new Error(`${field.label} is required.`);
    if (!value) continue;
    if (providerKey === "shopify" && field.id === "shopDomain") values[field.id] = normalizeShopDomain(value);
    else if (providerKey === "plausible" && field.id === "baseUrl") values[field.id] = normalizedHttpOrigin(value, field.label, false);
    else if (providerKey === "calcom" && field.id === "baseUrl") values[field.id] = normalizedHttpOrigin(value, field.label, true);
    else if (providerKey === "medusa" && field.id === "baseUrl") values[field.id] = normalizedHttpOrigin(value, field.label, false);
    else values[field.id] = value;
  }
  return values;
}

export function providerSetupFieldEnv(
  providerKey: ConnectionProviderKey,
  fields: Record<string, string>,
) {
  const manifest = connectorManifest(providerKey);
  return Object.fromEntries((manifest?.auth.setupFields ?? []).flatMap((field) => (
    fields[field.id] ? [[field.envKey, fields[field.id]]] : []
  )));
}
