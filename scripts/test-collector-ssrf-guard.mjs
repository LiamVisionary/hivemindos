import { register } from "node:module";
import assert from "node:assert/strict";

// Native TS type-stripping + `@/` alias + `server-only` stub via the shared
// loader, then dynamic-import the modules under test (the repo's standard
// hermetic-suite pattern). Run with: node scripts/test-collector-ssrf-guard.mjs
//
// Guards the defense-in-depth SSRF allowlist for client-supplied collector /
// telemetry URLs: only loopback / this machine / a Tailscale node / *.local is
// server-side fetchable; every other host (metadata endpoints, RFC-1918 LAN
// hosts, public IPs, arbitrary DNS names) is refused before any fetch runs.
register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const { isFleetCollectorUrl, assertFleetCollectorUrl, localInterfaceHosts } = await import(
  "../src/lib/services/local-collector-url.ts"
);
const { shellBaseFromCollectorUrl } = await import("../src/app/api/fleet/shell/shell-target.ts");

const selfHosts = localInterfaceHosts();
const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

// ── Fleet hosts are accepted (deterministic — accepted by explicit rule, not by
//    this machine's live interface set) ───────────────────────────────────────
const ACCEPT = [
  "http://127.0.0.1:8787", // loopback
  "http://localhost:8787", // loopback name
  "http://[::1]:8788", // IPv6 loopback
  "http://127.0.0.1:8788/peer/100.100.1.2%3A8787", // Hivemind Link peer proxy (loopback control)
  "http://100.64.0.5:8787", // Tailscale CGNAT (100.64.0.0/10) — low edge
  "http://100.127.255.255:8787", // Tailscale CGNAT — high edge
  "http://box.tail9f3c.ts.net:8787", // MagicDNS
  "http://hivemindos-liamsmbp.local:8787", // mDNS LAN collector
  "http://[fd7a:115c:a1e0::2]:8787", // Tailscale IPv6 ULA (fd7a:115c:a1e0::/48)
];
for (const url of ACCEPT) {
  assert.equal(isFleetCollectorUrl(url), true, `fleet host must be accepted: ${url}`);
  assert.equal(assertFleetCollectorUrl(url), url, `assert returns normalized fleet URL: ${url}`);
}

// ── Non-fleet hosts are rejected (guaranteed never a local interface) ─────────
const REJECT = [
  "http://169.254.169.254/latest/meta-data/", // cloud metadata (link-local)
  "http://metadata.google.internal/computeMetadata/v1/", // GCP metadata (DNS, .internal ≠ .local)
  "http://example.com/", // arbitrary public DNS name
  "http://1.2.3.4:8787", // public IP
  "http://100.63.255.255:8787", // just below the CGNAT block — NOT a Tailscale IP
  "http://100.128.0.1:8787", // just above the CGNAT block — NOT a Tailscale IP
  "http://200.64.0.1:8787", // shares octets with CGNAT but wrong first octet
  "ftp://100.64.0.1/", // fleet IP but non-http protocol
  "file:///etc/passwd", // non-http scheme
  "not-a-url", // unparseable
  "", // empty
  undefined, // missing
  "http://internal-admin/", // bare internal hostname (no .ts.net/.local)
];
for (const url of REJECT) {
  assert.equal(isFleetCollectorUrl(url), false, `non-fleet host must be rejected: ${JSON.stringify(url)}`);
  assert.throws(() => assertFleetCollectorUrl(url), /outside the fleet host set/, `assert throws for non-fleet URL: ${JSON.stringify(url)}`);
}

// ── RFC-1918 LAN hosts are rejected too, unless this test box genuinely owns
//    that address as one of its own interfaces (then it is legitimately self) ──
for (const url of ["http://10.0.0.5:8787", "http://192.168.1.1:8787", "http://172.16.0.1:8787"]) {
  if (selfHosts.has(hostOf(url))) continue; // this machine's own interface — legitimately fleet
  assert.equal(isFleetCollectorUrl(url), false, `RFC-1918 non-fleet host must be rejected: ${url}`);
}

// ── shellBaseFromCollectorUrl funnels every resolved base through the guard ───
assert.equal(
  shellBaseFromCollectorUrl("http://100.64.0.5:8787"),
  "http://100.64.0.5:8787",
  "shell base resolves a Tailscale peer",
);
assert.ok(
  /^http:\/\/(127\.0\.0\.1|localhost)/.test(String(shellBaseFromCollectorUrl("http://127.0.0.1:8787"))),
  "shell base maps loopback collector to the local link control",
);
for (const url of ["http://169.254.169.254/", "http://example.com/", "ftp://100.64.0.1/"]) {
  assert.equal(shellBaseFromCollectorUrl(url), null, `shell base refuses a non-fleet host: ${url}`);
}
for (const url of ["http://10.0.0.5:8787", "http://192.168.1.1:8787"]) {
  if (selfHosts.has(hostOf(url))) continue;
  assert.equal(shellBaseFromCollectorUrl(url), null, `shell base refuses an RFC-1918 host: ${url}`);
}

console.log("Collector URL SSRF guard checks passed.");
