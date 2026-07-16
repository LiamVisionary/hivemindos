#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || "") : "";
};

const rootArgument = valueAfter("--root");
const root = resolve(rootArgument || ".");
const port = Number(valueAfter("--port"));
if (!rootArgument || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Static app preview requires a project root and a port between 1024 and 65535.");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function safeTarget(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decoded.replace(/^\/+/, "") || "index.html";
  if (relativePath.includes("\0")) return null;
  const target = resolve(root, relativePath);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
}

async function containsSymbolicLink(target) {
  const relative = target.slice(root.length).replace(/^[/\\]+/, "");
  let cursor = root;
  for (const segment of relative.split(/[\\/]+/).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    const info = await lstat(cursor).catch(() => null);
    if (!info) return false;
    if (info.isSymbolicLink()) return true;
  }
  return false;
}

async function resolvedFile(pathname) {
  const target = safeTarget(pathname);
  if (!target) return null;
  if (await containsSymbolicLink(target)) return null;
  const info = await lstat(target).catch(() => null);
  if (info?.isSymbolicLink()) return null;
  if (info?.isFile()) return { target, info };
  if (info?.isDirectory()) {
    const index = resolve(target, "index.html");
    if (await containsSymbolicLink(index)) return null;
    const indexInfo = await lstat(index).catch(() => null);
    if (indexInfo?.isFile() && !indexInfo.isSymbolicLink()) return { target: index, info: indexInfo };
  }
  const fallback = resolve(root, "index.html");
  if (await containsSymbolicLink(fallback)) return null;
  const fallbackInfo = await lstat(fallback).catch(() => null);
  return fallbackInfo?.isFile() && !fallbackInfo.isSymbolicLink()
    ? { target: fallback, info: fallbackInfo }
    : null;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }
  const file = await resolvedFile(new URL(request.url || "/", "http://127.0.0.1").pathname);
  if (!file) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": file.info.size,
    "content-type": contentTypes.get(extname(file.target).toLowerCase()) || "application/octet-stream",
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = createReadStream(file.target);
  stream.on("error", () => {
    if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Could not read app asset");
  });
  stream.pipe(response);
});

server.listen(port, "127.0.0.1");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
