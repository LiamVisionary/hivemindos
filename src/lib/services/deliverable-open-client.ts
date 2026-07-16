import { nativeOrFetch } from "@/lib/native/bridge";

export type DeliverableOpenApplication = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type DeliverableOpenCapabilities = {
  ok?: boolean;
  available: boolean;
  apps: DeliverableOpenApplication[];
  error?: string;
  fileManagerLabel: string;
  source?: "local" | "synced-vault";
};

export type DeliverableSourceMachine = {
  collectorUrl: string;
  name: string;
};

export type DeliverableOpenAction = "folder" | "open" | "open-in" | "reveal";

type DeliverableOpenResult = {
  ok?: boolean;
  error?: string;
};

type DeliverableDownloadResult = DeliverableOpenResult & {
  displayPath?: string;
  path?: string;
};

async function responseJson<T extends { ok?: boolean; error?: string }>(response: Response) {
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "HivemindOS could not open that file.");
  }
  return data;
}

export async function loadDeliverableOpenCapabilities(path: string) {
  return nativeOrFetch<DeliverableOpenCapabilities>({
    command: "list_open_in_apps",
    args: { path },
    fallback: async () => responseJson<DeliverableOpenCapabilities>(await fetch(
      `/api/kanban/deliverable?${new URLSearchParams({ path }).toString()}`,
      { cache: "no-store" },
    )),
  });
}

export async function loadDeliverableAvailability(path: string) {
  return responseJson<DeliverableOpenCapabilities>(await fetch(
    `/api/kanban/deliverable?${new URLSearchParams({ inspect: "availability", path }).toString()}`,
    { cache: "no-store" },
  ));
}

async function runHttpAction(path: string, action: DeliverableOpenAction, appId?: string) {
  return responseJson<DeliverableOpenResult>(await fetch("/api/kanban/deliverable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, appId, path }),
  }));
}

export async function runDeliverableOpenAction(input: {
  action: DeliverableOpenAction;
  appId?: string;
  path: string;
}) {
  const command = input.action === "open-in" ? "open_in_app" : "open_deliverable";
  const args = input.action === "open-in"
    ? { app: input.appId, path: input.path }
    : { action: input.action, path: input.path };
  return nativeOrFetch<DeliverableOpenResult>({
    command,
    args,
    fallback: () => runHttpAction(input.path, input.action, input.appId),
  });
}

export async function downloadDeliverableToDevice(input: {
  path: string;
  sourceMachine: DeliverableSourceMachine;
}) {
  return responseJson<DeliverableDownloadResult>(await fetch("/api/kanban/deliverable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "download", path: input.path, sourceMachine: input.sourceMachine }),
  }));
}
