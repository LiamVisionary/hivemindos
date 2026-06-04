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

export function clawMobilePairingUrl(input: { hubUrl: string; name: string }) {
  return `clawcodemobile://pair?hub=${encodeURIComponent(input.hubUrl)}&name=${encodeURIComponent(input.name)}`;
}
