export function currentHubPort() {
  if (typeof window === "undefined") return "";
  if (window.location.port) return window.location.port;
  return window.location.protocol === "https:" ? "443" : "80";
}

export function hubUrlForPairingHost(host: string) {
  const cleanHost = host.trim().replace(/\/+$/, "");
  const port = currentHubPort();
  return port ? `http://${cleanHost}:${port}` : `http://${cleanHost}`;
}

export function clawMobilePairingUrl(input: {
  hubUrl: string;
  name: string;
  machineId?: string;
  /** Shared dashboard device token — provisioned into the app so a paired phone
   *  authenticates to this hub's /api gate with no user-visible token step. */
  token?: string;
}) {
  const params = new URLSearchParams({
    hub: input.hubUrl,
    name: input.name,
  });
  if (input.machineId) params.set("machineId", input.machineId);
  if (input.token) params.set("token", input.token);
  return `clawcodemobile://pair?${params.toString()}`;
}
