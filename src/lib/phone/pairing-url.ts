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

export function clawMobilePairingUrl(input: { hubUrl: string; name: string; machineId?: string }) {
  const params = new URLSearchParams({
    hub: input.hubUrl,
    name: input.name,
  });
  if (input.machineId) params.set("machineId", input.machineId);
  return `clawcodemobile://pair?${params.toString()}`;
}
