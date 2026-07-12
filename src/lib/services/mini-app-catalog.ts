import { optionalEnv } from "@/lib/config/env";

export const OFFICIAL_MINI_APP_CATALOG_URL = "https://hivemindos.app/mini-apps/catalog.json";
export const MINI_APP_CATALOG_URL_ENV = "HIVEMINDOS_MINI_APP_CATALOG_URL";

export function miniAppCatalogSourceUrl(): string {
  return optionalEnv(MINI_APP_CATALOG_URL_ENV) || OFFICIAL_MINI_APP_CATALOG_URL;
}

export type MiniAppStatus = "live" | "preview" | "coming-soon";

export type MiniAppCatalogEntry = {
  id: string;
  name: string;
  eyebrow: string;
  description: string;
  url: string;
  iconUrl: string;
  status: MiniAppStatus;
  priceLabel: string;
  cta: string;
  tags: string[];
};

export type MiniAppCatalog = {
  version: 1;
  updatedAt: string;
  apps: MiniAppCatalogEntry[];
};

type FetchMiniAppCatalogOptions = {
  sourceUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function textValue(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}.${field} must be a non-empty string.`);
  return value.trim();
}

function httpUrl(value: string, sourceUrl: string, label: string): string {
  const url = new URL(value, sourceUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${label} must use http or https.`);
  return url.toString();
}

function parseEntry(value: unknown, sourceUrl: string, index: number): MiniAppCatalogEntry {
  const label = `apps[${index}]`;
  const record = objectValue(value, label);
  const status = textValue(record, "status", label);
  if (status !== "live" && status !== "preview" && status !== "coming-soon") {
    throw new Error(`${label}.status is unsupported.`);
  }
  if (!Array.isArray(record.tags) || !record.tags.length) throw new Error(`${label}.tags must contain at least one tag.`);
  const tags = record.tags.map((tag, tagIndex) => {
    if (typeof tag !== "string" || !tag.trim()) throw new Error(`${label}.tags[${tagIndex}] must be a non-empty string.`);
    return tag.trim();
  });

  return {
    id: textValue(record, "id", label),
    name: textValue(record, "name", label),
    eyebrow: textValue(record, "eyebrow", label),
    description: textValue(record, "description", label),
    url: httpUrl(textValue(record, "href", label), sourceUrl, `${label}.href`),
    iconUrl: httpUrl(textValue(record, "icon", label), sourceUrl, `${label}.icon`),
    status,
    priceLabel: textValue(record, "priceLabel", label),
    cta: textValue(record, "cta", label),
    tags,
  };
}

export function parseMiniAppCatalog(value: unknown, sourceUrl = OFFICIAL_MINI_APP_CATALOG_URL): MiniAppCatalog {
  const record = objectValue(value, "catalog");
  if (record.version !== 1) throw new Error("The mini-app catalog uses an unsupported contract version.");
  const updatedAt = textValue(record, "updatedAt", "catalog");
  if (Number.isNaN(Date.parse(updatedAt))) throw new Error("catalog.updatedAt must be an ISO timestamp.");
  if (!Array.isArray(record.apps)) throw new Error("catalog.apps must be an array.");
  const apps = record.apps.map((entry, index) => parseEntry(entry, sourceUrl, index));
  const ids = new Set<string>();
  for (const app of apps) {
    if (ids.has(app.id)) throw new Error(`Duplicate mini-app id: ${app.id}`);
    ids.add(app.id);
  }
  return { version: 1, updatedAt, apps };
}

export async function fetchMiniAppCatalog(options: FetchMiniAppCatalogOptions = {}): Promise<MiniAppCatalog> {
  const sourceUrl = options.sourceUrl ?? OFFICIAL_MINI_APP_CATALOG_URL;
  const response = await (options.fetcher ?? fetch)(sourceUrl, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`The official catalog returned ${response.status} ${response.statusText}.`);
  return parseMiniAppCatalog(await response.json(), sourceUrl);
}
