export function shouldUseTailscaleCliFallback({
  platform = process.platform,
  env = process.env,
} = {}) {
  return (
    platform !== "darwin"
    || env.HIVEMIND_TAILSCALE_CLI_FALLBACK === "1"
  );
}
