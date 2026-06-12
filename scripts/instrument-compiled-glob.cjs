// Diagnostic: append a wrapper to next/dist/compiled/glob that prints the
// pattern, cwd, and stack whenever a glob touches the OS user profile. Module
// level (not NODE_OPTIONS) so it also fires inside Next's worker processes,
// which rewrite NODE_OPTIONS. Breaks the pnpm hard link before editing so the
// content-addressable store is never modified.
const fs = require("fs");

const globPath = require.resolve("next/dist/compiled/glob");
const marker = "HIVE GLOB DIAGNOSTIC";
const source = fs.readFileSync(globPath, "utf8");
if (source.includes(marker)) {
  console.log(`already instrumented: ${globPath}`);
  process.exit(0);
}

const wrapper = `
// --- ${marker} (CI only) ---
(() => {
  const home = require("os").homedir().toLowerCase();
  const orig = module.exports;
  if (typeof orig !== "function") return;
  function flag(pattern, options) {
    try {
      const cwd = String((options && options.cwd) || process.cwd()).toLowerCase();
      const pat = String(pattern || "").toLowerCase();
      if (cwd.startsWith(home) || pat.includes(home)) {
        process.stderr.write("\\n[glob-diag] pattern=" + pattern + " cwd=" + (options && options.cwd) + "\\n" + new Error("glob-diag").stack + "\\n");
      }
    } catch {}
  }
  function wrapped(pattern, options, cb) {
    flag(pattern, typeof options === "object" && options !== null ? options : undefined);
    return orig.apply(this, arguments);
  }
  Object.assign(wrapped, orig);
  module.exports = wrapped;
})();
`;

// copy + rename replaces the inode, detaching from the pnpm store hard link
fs.copyFileSync(globPath, `${globPath}.detached`);
fs.appendFileSync(`${globPath}.detached`, wrapper);
fs.renameSync(`${globPath}.detached`, globPath);
console.log(`instrumented: ${globPath}`);
