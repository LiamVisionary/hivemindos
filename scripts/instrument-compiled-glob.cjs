// Diagnostic: append a wrapper to next/dist/compiled/glob that prints the
// pattern, cwd, and stack whenever a glob touches the OS user profile. Module
// level (not NODE_OPTIONS) so it also fires inside Next's worker processes,
// which rewrite NODE_OPTIONS. Breaks the pnpm hard link before editing so the
// content-addressable store is never modified.
const fs = require("fs");

const resolveFromCwd = (id) => require.resolve(id, { paths: [process.cwd()] });
const globPath = resolveFromCwd("next/dist/compiled/glob");
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

// Also patch @vercel/nft's emitAssetDirectory to log WHICH analyzed file
// caused a directory-asset glob — the glob stack alone only shows nft
// internals. Anchors verified unique against nft in next 16.2.6.
const nftPath = resolveFromCwd("next/dist/compiled/@vercel/nft");
let nft = fs.readFileSync(nftPath, "utf8");
const anchor1 = "const emitAssetDirectory=e=>{";
const anchor2 = '{if(r.log)console.log("Globbing "+u+d);';
const anchor3 = "u=f.homedir();if(u&&r.match(a)){e[t]=o.resolve(u,r.substr(2))}";
if (nft.includes("__nftDiagFile")) {
  console.log(`already instrumented: ${nftPath}`);
} else if (nft.includes(anchor1) && nft.includes(anchor2)) {
  nft = nft.replace(
    anchor1,
    'const __nftDiagFile=e;const emitAssetDirectory=e=>{try{process.stderr.write("[nft-emit-raw] "+JSON.stringify(e)+" from "+__nftDiagFile+"\\n");}catch{};'
  );
  nft = nft.replace(
    anchor2,
    '{try{process.stderr.write("[nft-diag] asset-dir "+u+d+" from "+__nftDiagFile+"\\n");}catch{};if(r.log)console.log("Globbing "+u+d);'
  );
  if (nft.includes(anchor3)) {
    nft = nft.replace(
      anchor3,
      'u=f.homedir();if(u&&r.match(a)){try{process.stderr.write("[nft-tilde] "+JSON.stringify(r)+"\\n");}catch{};e[t]=o.resolve(u,r.substr(2))}'
    );
  } else {
    console.log("tilde anchor not found; skipped tilde logging");
  }
  fs.copyFileSync(nftPath, `${nftPath}.detached`);
  fs.writeFileSync(`${nftPath}.detached`, nft);
  fs.renameSync(`${nftPath}.detached`, nftPath);
  console.log(`instrumented: ${nftPath}`);
} else {
  console.log(`nft anchors not found; skipped: ${nftPath}`);
}
