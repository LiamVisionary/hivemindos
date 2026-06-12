// Diagnostic preload: print a stack trace whenever anything lists the OS user
// profile root (or its protected junctions like Cookies) so we can find what
// walks the home directory during `next build` on Windows.
// Usage: NODE_OPTIONS="--require <abs path to this file>" pnpm exec next build
const fs = require("fs");
const os = require("os");

const home = os.homedir();
const homeLower = home.toLowerCase();

function report(target) {
  const stack = new Error(`scan of ${target}`).stack || "";
  process.stderr.write(`\n[trace-profile-scandir] ${target}\n${stack}\n`);
}

function check(target) {
  try {
    if (typeof target !== "string") return;
    const lower = target.toLowerCase();
    if (!lower.startsWith(homeLower)) return;
    const rest = lower.slice(homeLower.length).replace(/^[\\/]/, "").replace(/[\\/]$/, "");
    // Only the profile root itself or the protected junction that EPERMs —
    // legitimate reads of e.g. ~/.hivemindos are first-level too and fine.
    if (rest === "" || rest === "cookies") {
      report(target);
    }
  } catch {
    // Never let diagnostics break the build.
  }
}

for (const name of ["readdir", "readdirSync", "opendir", "opendirSync"]) {
  const original = fs[name];
  if (typeof original !== "function") continue;
  fs[name] = function (target, ...rest) {
    check(target);
    return original.call(this, target, ...rest);
  };
}

for (const name of ["readdir", "opendir"]) {
  const original = fs.promises[name];
  if (typeof original !== "function") continue;
  fs.promises[name] = function (target, ...rest) {
    check(target);
    return original.call(this, target, ...rest);
  };
}
