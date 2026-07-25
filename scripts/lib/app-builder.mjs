import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, openSync } from "node:fs";
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createServer } from "node:net";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.HIVEMINDOS_APP_DIR
  ? resolve(process.env.HIVEMINDOS_APP_DIR)
  : resolve(moduleDirectory, "../..");
const contractFile = resolve(appRoot, "contracts/app-builder/v1.json");
const staticServerFile = resolve(appRoot, "scripts/lib/app-builder-static-server.mjs");
const manifestName = ".hivemindos-app.json";
const runtimeDirectoryName = ".hivemindos";
const hostingManifestName = "hosting.json";
const ignoredEntries = new Set([".git", ".next", "node_modules", runtimeDirectoryName, manifestName, ".DS_Store"]);
const maxReadBytes = 500_000;
const maxWriteBytes = 750_000;
const maxCommandOutputBytes = 128_000;
const hostingSecretName = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/i;
const cachedContract = JSON.parse(await readFile(contractFile, "utf8"));
if (cachedContract?.protocol !== "hivemindos.app-builder/v1" || !cachedContract.templates?.nextjs?.files || !cachedContract.templates?.static?.files?.["index.html"]) {
  throw new Error("The HivemindOS app-builder contract is invalid.");
}
export const APP_BUILDER_CONTRACT_VERSION = cachedContract.version;
const staticArtifactContract = cachedContract.artifacts.static;
const dynamicArtifactContract = cachedContract.artifacts.dynamic;
const maxHostingFiles = staticArtifactContract.clientLimits.files;
const maxHostingFileBytes = staticArtifactContract.clientLimits.fileBytes;
const maxHostingArtifactBytes = staticArtifactContract.clientLimits.totalBytes;
export const APP_BUILDER_CONFIRMATIONS = Object.freeze({ ...cachedContract.confirmations });

export async function loadAppBuilderContract() {
  return cachedContract;
}

function requireConfirmation(actual, expected) {
  if (actual !== expected) throw new Error(`This app-builder operation requires ${expected}.`);
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new Error("App project name must be between 1 and 80 characters.");
  return name;
}

function expandHome(value) {
  const path = String(value || "").trim();
  if (!path) throw new Error("A selected project directory is required.");
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith(`~${sep}`)) return join(homedir(), path.slice(2));
  return path;
}

async function projectDirectory(value, { allowMissing = false } = {}) {
  const directory = resolve(expandHome(value));
  const info = await lstat(directory).catch(() => null);
  if (info?.isSymbolicLink()) throw new Error("Project directory cannot be a symbolic link.");
  if (info && !info.isDirectory()) throw new Error("Project path is not a directory.");
  if (!info && !allowMissing) throw new Error("Project directory does not exist.");
  const parentInfo = await stat(dirname(directory)).catch(() => null);
  if (!parentInfo?.isDirectory()) throw new Error("Project parent directory does not exist.");
  return directory;
}

async function creatableProjectDirectory(value, workspaceValue) {
  if (!String(workspaceValue || "").trim()) return projectDirectory(value, { allowMissing: true });
  const workspace = await projectDirectory(workspaceValue);
  const directory = resolve(expandHome(value));
  if (directory === workspace || !directory.startsWith(`${workspace}${sep}`)) {
    throw new Error("The app project must stay inside the selected chat workspace.");
  }
  const parentSegments = relative(workspace, dirname(directory)).split(sep).filter(Boolean);
  let cursor = workspace;
  for (const segment of parentSegments) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error("Project directory cannot traverse a symbolic link.");
    if (info && !info.isDirectory()) throw new Error("Project parent path is not a directory.");
    if (!info) await mkdir(cursor, { recursive: false, mode: 0o700 });
  }
  return projectDirectory(directory, { allowMissing: true });
}

function normalizeRelativePath(value) {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  if (!raw || raw.length > 1_000 || raw.includes("\0") || raw.startsWith("/") || /^[a-z]:\//i.test(raw)) {
    throw new Error("App file path must be a bounded relative path.");
  }
  const normalized = posix.normalize(raw).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("App file path escapes the project workspace.");
  }
  return normalized;
}

async function pathInsideProject(directory, relativePath, { allowMissing = false } = {}) {
  const normalized = normalizeRelativePath(relativePath);
  const target = resolve(directory, ...normalized.split("/"));
  if (!target.startsWith(`${directory}${sep}`)) throw new Error("App file path escapes the project workspace.");
  let cursor = directory;
  for (const segment of normalized.split("/")) {
    cursor = join(cursor, segment);
    const info = await lstat(cursor).catch(() => null);
    if (!info) break;
    if (info.isSymbolicLink()) throw new Error("App file path cannot traverse a symbolic link.");
  }
  if (!allowMissing && !(await lstat(target).catch(() => null))) throw new Error("App file was not found.");
  return { target, relativePath: normalized };
}

async function atomicWrite(path, content, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.hive-app-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function manifestPath(directory) {
  return join(directory, manifestName);
}

async function readManifest(directory) {
  const path = manifestPath(directory);
  const info = await lstat(path).catch(() => null);
  if (!info) return null;
  if (info.isSymbolicLink()) throw new Error("Project manifest cannot be a symbolic link.");
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const parsed = JSON.parse(await handle.readFile("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } finally {
    await handle.close();
  }
}

function hostingManifestPath(directory) {
  return join(directory, runtimeDirectoryName, hostingManifestName);
}

export async function readLocalHostingManifest(directoryValue) {
  const { directory } = await requiredProject(directoryValue);
  const path = hostingManifestPath(directory);
  const info = await lstat(path).catch(() => null);
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Hosting manifest must be a regular file.");
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Hosting manifest is invalid.");
  const projectId = String(parsed.project_id || "").trim();
  const d1 = normalizeHostingBindingNames(parsed.d1);
  const r2 = normalizeHostingBindingNames(parsed.r2);
  if (!projectId || projectId.length > 200) throw new Error("Hosting manifest project_id is invalid.");
  return { project_id: projectId, ...(d1.length ? { d1 } : {}), ...(r2.length ? { r2 } : {}) };
}

export async function writeLocalHostingManifest(directoryValue, input) {
  const { directory } = await requiredProject(directoryValue);
  const projectId = String(input?.projectId || "").trim();
  if (!projectId || projectId.length > 200) throw new Error("Hosting project id is required.");
  const d1 = normalizeHostingBindingNames(input?.bindings?.d1);
  const r2 = normalizeHostingBindingNames(input?.bindings?.r2);
  const manifest = { project_id: projectId, ...(d1.length ? { d1 } : {}), ...(r2.length ? { r2 } : {}) };
  await atomicWrite(hostingManifestPath(directory), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readLocalAppSourceCommit(directoryValue) {
  const { directory } = await requiredProject(directoryValue);
  const result = await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"], {
    cwd: directory,
    env: safeCommandEnvironment(),
    timeout: 5_000,
    maxBuffer: 4_096,
    windowsHide: true,
  }).catch(() => null);
  const sha = String(result?.stdout || "").trim();
  return /^[a-f0-9]{40,64}$/i.test(sha) ? sha.toLowerCase() : null;
}

function normalizeHostingBindingNames(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("Hosting binding names must be an array with at most 8 entries.");
  const names = value.map((candidate) => String(candidate || "").trim());
  if (names.some((name) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(name)) || new Set(names).size !== names.length) {
    throw new Error("Hosting binding names must be unique uppercase identifiers.");
  }
  return names;
}

async function requiredProject(value) {
  const directory = await projectDirectory(value);
  const project = await readManifest(directory);
  if (!project || project.protocol !== "hivemindos.app-builder/v1" || project.backend !== "local") {
    throw new Error("The selected directory is not a HivemindOS app-builder project.");
  }
  if (project.directory !== directory) throw new Error("Project manifest belongs to another directory.");
  return { directory, project };
}

async function writeManifest(directory, project) {
  const next = { ...project, updatedAt: new Date().toISOString() };
  await atomicWrite(manifestPath(directory), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function createLocalAppProject(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.createProject);
  const contract = await loadAppBuilderContract();
  const templateId = String(input?.templateId || "nextjs").trim().toLowerCase();
  const template = contract.templates[templateId];
  if (!template) throw new Error("Only reviewed app-builder templates can be created.");
  const name = cleanName(input?.name);
  const directory = await creatableProjectDirectory(input?.directory, input?.workspaceDirectory);
  const existing = await readManifest(directory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    if (existing.name !== name || existing.templateId !== templateId || existing.directory !== directory) {
      throw new Error("Project directory already belongs to a different app project.");
    }
    return { created: false, project: existing };
  }
  const directoryInfo = await lstat(directory).catch(() => null);
  if (directoryInfo) {
    const entries = (await readdir(directory)).filter((entry) => entry !== ".DS_Store");
    if (entries.length) throw new Error("Project directory must be empty.");
  } else {
    await mkdir(directory, { recursive: false, mode: 0o700 });
  }
  for (const [relativePath, content] of Object.entries(template.files)) {
    const target = await pathInsideProject(directory, relativePath, { allowMissing: true });
    await atomicWrite(target.target, String(content));
  }
  const now = new Date().toISOString();
  const project = {
    protocol: contract.protocol,
    contractVersion: contract.version,
    id: `local_${createHash("sha256").update(directory).digest("hex").slice(0, 20)}`,
    backend: "local",
    name,
    templateId,
    directory,
    status: "stopped",
    dependenciesReady: templateId === "static",
    previewUrl: null,
    pid: null,
    port: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await atomicWrite(manifestPath(directory), `${JSON.stringify(project, null, 2)}\n`);
  return { created: true, project };
}

async function detectedLocalTemplate(directory) {
  const staticIndex = await lstat(join(directory, "index.html")).catch(() => null);
  if (staticIndex?.isFile() && !staticIndex.isSymbolicLink()) return "static";
  const packagePath = join(directory, "package.json");
  const packageInfo = await lstat(packagePath).catch(() => null);
  if (packageInfo?.isFile() && !packageInfo.isSymbolicLink()) {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const dependencies = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
    if (typeof dependencies.next === "string") return "nextjs";
  }
  throw new Error("Only an existing Next.js project or a static app with index.html can be adopted.");
}

export async function adoptLocalAppProject(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.createProject);
  const contract = await loadAppBuilderContract();
  const directory = await projectDirectory(input?.directory);
  const workspaceDirectory = await projectDirectory(input?.workspaceDirectory || input?.directory);
  if (directory !== workspaceDirectory && !directory.startsWith(`${workspaceDirectory}${sep}`)) {
    throw new Error("The app project must stay inside the selected chat workspace.");
  }
  const existing = await readManifest(directory);
  if (existing) return { adopted: false, project: (await requiredProject(directory)).project };
  const templateId = await detectedLocalTemplate(directory);
  const name = cleanName(input?.name || basename(directory));
  const nextBinary = join(directory, "node_modules", "next", "dist", "bin", "next");
  const nextBinaryInfo = templateId === "nextjs" ? await lstat(nextBinary).catch(() => null) : null;
  const now = new Date().toISOString();
  const project = {
    protocol: contract.protocol,
    contractVersion: contract.version,
    id: `local_${createHash("sha256").update(directory).digest("hex").slice(0, 20)}`,
    backend: "local",
    name,
    templateId,
    directory,
    status: "stopped",
    dependenciesReady: templateId === "static" || Boolean(nextBinaryInfo?.isFile() && !nextBinaryInfo.isSymbolicLink()),
    previewUrl: null,
    pid: null,
    port: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
  await atomicWrite(manifestPath(directory), `${JSON.stringify(project, null, 2)}\n`);
  return { adopted: true, project };
}

export async function getLocalAppProject(input) {
  const { directory, project } = await requiredProject(input?.directory);
  return reconcileLocalAppRuntimeState(directory, project);
}

export async function listLocalAppFiles(input) {
  const { directory } = await requiredProject(input?.directory);
  const relativePath = input?.path ? normalizeRelativePath(input.path) : "";
  const target = relativePath ? (await pathInsideProject(directory, relativePath)).target : directory;
  const info = await stat(target);
  if (!info.isDirectory()) throw new Error("Selected app path is not a directory.");
  const entries = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (ignoredEntries.has(entry.name)) continue;
    const path = join(target, entry.name);
    const itemInfo = await lstat(path);
    if (itemInfo.isSymbolicLink()) continue;
    entries.push({
      name: entry.name,
      path: [...(relativePath ? [relativePath] : []), entry.name].join("/"),
      type: entry.isDirectory() ? "dir" : "file",
      size: entry.isFile() ? itemInfo.size : undefined,
      updatedAt: itemInfo.mtimeMs,
    });
  }
  entries.sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "dir" ? -1 : 1);
  return { path: relativePath, entries };
}

export async function readLocalAppFile(input) {
  const { directory } = await requiredProject(input?.directory);
  const resolved = await pathInsideProject(directory, input?.path);
  const info = await stat(resolved.target);
  if (!info.isFile()) throw new Error("Selected app path is not a file.");
  if (info.size > maxReadBytes) throw new Error("App file is too large to read.");
  return { path: resolved.relativePath, content: await readFile(resolved.target, "utf8"), size: info.size, updatedAt: info.mtimeMs };
}

export async function writeLocalAppFile(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.writeFile);
  const { directory } = await requiredProject(input?.directory);
  const content = String(input?.content ?? "");
  if (Buffer.byteLength(content, "utf8") > maxWriteBytes) throw new Error("App file content is too large to write.");
  const resolved = await pathInsideProject(directory, input?.path, { allowMissing: true });
  await atomicWrite(resolved.target, content);
  return readLocalAppFile({ directory, path: resolved.relativePath });
}

export async function renameLocalAppFile(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.renameFile);
  const { directory } = await requiredProject(input?.directory);
  const source = await pathInsideProject(directory, input?.path);
  const destination = await pathInsideProject(directory, input?.nextPath, { allowMissing: true });
  if (await lstat(destination.target).catch(() => null)) throw new Error("App file destination already exists.");
  await mkdir(dirname(destination.target), { recursive: true, mode: 0o700 });
  await rename(source.target, destination.target);
  return { path: destination.relativePath };
}

export async function deleteLocalAppFile(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.deleteFile);
  const { directory } = await requiredProject(input?.directory);
  const resolved = await pathInsideProject(directory, input?.path);
  await rm(resolved.target, { recursive: true, force: false });
  return { deleted: true, path: resolved.relativePath };
}

export function localAppRuntimeCommand(directory, port, templateId = "nextjs") {
  if (templateId === "static") {
    return {
      command: process.execPath,
      args: [staticServerFile, "--root", directory, "--port", String(port)],
      ownershipToken: staticServerFile,
    };
  }
  const nextBinary = join(directory, "node_modules", "next", "dist", "bin", "next");
  return {
    command: process.execPath,
    args: [nextBinary, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    ownershipToken: nextBinary,
  };
}

export async function installLocalAppDependencies(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.installDependencies);
  const { directory, project } = await requiredProject(input?.directory);
  if (project.templateId === "static") {
    const next = project.dependenciesReady
      ? project
      : await writeManifest(directory, { ...project, dependenciesReady: true, lastError: null });
    return { project: next, output: "Static HTML apps do not require dependency installation." };
  }
  const result = await execFileAsync(process.platform === "win32" ? "npm.cmd" : "npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ], { cwd: directory, timeout: 300_000, maxBuffer: maxCommandOutputBytes });
  const next = await writeManifest(directory, { ...project, dependenciesReady: true, lastError: null });
  return { project: next, output: String(result.stdout || "").slice(-4_000) };
}

async function unusedLoopbackPort(preferred) {
  const requested = preferred === undefined || preferred === null ? 0 : Number(preferred);
  if (!Number.isInteger(requested) || requested < 0 || requested > 65535 || (requested > 0 && requested < 1024)) {
    throw new Error("App preview port must be between 1024 and 65535.");
  }
  const server = createServer();
  await new Promise((resolvePromise, reject) => server.once("error", reject).listen(requested, "127.0.0.1", resolvePromise));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  if (!port) throw new Error("Could not reserve an app preview port.");
  return port;
}

async function waitForPreview(url, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`App runtime exited with status ${child.exitCode}.`);
    const response = await fetch(url, { signal: AbortSignal.timeout(500) }).catch(() => null);
    if (response) {
      await response.body?.cancel().catch(() => undefined);
      if (response.ok || response.status < 500) return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("App runtime did not become ready on loopback.");
}

function localAppRuntimeEnvironment(port) {
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "LANG",
    "LC_ALL",
    "TERM",
    "CI",
  ];
  const env = {};
  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, NODE_ENV: "development", HOSTNAME: "127.0.0.1", PORT: String(port) };
}

async function processCommand(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  if (process.platform === "win32") {
    const script = `(Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\").CommandLine`;
    return String((await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 3_000 })).stdout || "").trim();
  }
  return String((await execFileAsync("ps", ["-p", String(pid), "-o", "command="], { timeout: 3_000 })).stdout || "").trim();
}

async function ownedProcessCommand(project) {
  const pid = Number(project.pid);
  if (!Number.isInteger(pid) || pid <= 0) return "";
  const command = await processCommand(pid).catch(() => "");
  const expected = localAppRuntimeCommand(project.directory, project.port, project.templateId).ownershipToken;
  return command.includes(expected) ? command : "";
}

// Stamped by the status reconcile when the runtime process died underneath a
// "running" manifest (collector restart, crash). Distinguishes an interrupted
// runtime from a user-requested stop (stop clears lastError), so the boot
// reconcile knows which stopped projects it may restart.
export const APP_BUILDER_RUNTIME_EXITED_MESSAGE = "The app preview process exited and can be restarted.";

async function reconcileLocalAppRuntimeState(directory, project) {
  if (project.status !== "running") return project;
  if (await ownedProcessCommand(project)) return project;
  return writeManifest(directory, {
    ...project,
    status: "stopped",
    pid: null,
    port: null,
    previewUrl: null,
    lastError: APP_BUILDER_RUNTIME_EXITED_MESSAGE,
  });
}

/**
 * Boot-time reconcile for one project: restart its preview runtime when the
 * manifest says it should be running but the process is gone — either a stale
 * "running" manifest with a dead pid (the collector that owned the child was
 * restarted before any status poll noticed), or a reconcile-stamped exited
 * stop. A user-requested stop (status "stopped", lastError null) is never
 * restarted. The start goes through startLocalAppProject with the standard
 * CONFIRM_APP_RUNTIME contract — the runtime was originally started under an
 * explicit confirmation, and this only restores that already-confirmed state.
 * Prefers the previous port so stale preview URLs keep working; falls back to
 * a fresh port when the old one is taken.
 */
export async function restartInterruptedLocalAppProject(directoryValue) {
  const { directory, project } = await requiredProject(directoryValue);
  const exitedWhileRunning = project.status === "running" && !(await ownedProcessCommand(project));
  const reconciledExit = project.status === "stopped" && project.lastError === APP_BUILDER_RUNTIME_EXITED_MESSAGE;
  if (!exitedWhileRunning && !reconciledExit) return { restarted: false, project };
  const preferredPort = Number.isInteger(project.port) && project.port > 0 ? project.port : undefined;
  // Stamp the exited state before starting: a foreign process that grabbed the
  // dead runtime's port must not satisfy start's running-short-circuit and get
  // blessed as the preview (port reservation then routes it to a fresh port).
  if (exitedWhileRunning) await reconcileLocalAppRuntimeState(directory, project);
  try {
    const started = await startLocalAppProject({ directory, port: preferredPort, confirmation: APP_BUILDER_CONFIRMATIONS.startRuntime });
    return { restarted: true, project: started.project };
  } catch (error) {
    if (!preferredPort || error?.code !== "EADDRINUSE") throw error;
    const started = await startLocalAppProject({ directory, confirmation: APP_BUILDER_CONFIRMATIONS.startRuntime });
    return { restarted: true, project: started.project };
  }
}
async function stopOwnedProcess(project) {
  const pid = Number(project.pid);
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (!await ownedProcessCommand(project)) throw new Error("Refusing to stop a process that is no longer owned by this app project.");
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { timeout: 5_000 }).catch(() => undefined);
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
}

export async function startLocalAppProject(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.startRuntime);
  const { directory, project } = await requiredProject(input?.directory);
  if (project.status === "running" && project.previewUrl) {
    const response = await fetch(project.previewUrl, { signal: AbortSignal.timeout(500) }).catch(() => null);
    if (response) {
      await response.body?.cancel().catch(() => undefined);
      return { project };
    }
  }
  const port = await unusedLoopbackPort(input?.port);
  const runtime = localAppRuntimeCommand(directory, port, project.templateId);
  const binaryInfo = await lstat(runtime.ownershipToken).catch(() => null);
  if (!binaryInfo?.isFile() || binaryInfo.isSymbolicLink()) {
    throw new Error(project.templateId === "static"
      ? "The bundled static preview runtime is unavailable."
      : `Install project dependencies first with ${APP_BUILDER_CONFIRMATIONS.installDependencies}.`);
  }
  const runtimeDirectory = join(directory, runtimeDirectoryName);
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  const logPath = join(runtimeDirectory, "runtime.log");
  const stdout = openSync(logPath, "a", 0o600);
  const stderr = openSync(logPath, "a", 0o600);
  let child;
  try {
    child = spawn(runtime.command, runtime.args, {
      cwd: directory,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
      env: localAppRuntimeEnvironment(port),
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  child.unref();
  const previewUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForPreview(previewUrl, child);
  } catch (error) {
    if (child.pid) await stopOwnedProcess({ ...project, directory, pid: child.pid, port }).catch(() => undefined);
    await writeManifest(directory, { ...project, status: "error", pid: null, port: null, previewUrl: null, lastError: error instanceof Error ? error.message : "App runtime failed." });
    throw error;
  }
  const next = await writeManifest(directory, { ...project, status: "running", pid: child.pid, port, previewUrl, lastError: null });
  return { project: next };
}

export async function stopLocalAppProject(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.stopRuntime);
  const { directory, project } = await requiredProject(input?.directory);
  if (project.status === "running" && project.pid) await stopOwnedProcess(project);
  const next = await writeManifest(directory, { ...project, status: "stopped", pid: null, port: null, previewUrl: null, lastError: null });
  return { project: next };
}

function cleanDeploymentName(value) {
  const slug = String(value || "hivemindos-app")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "hivemindos-app";
}

async function collectHostingFiles(root, relativeDirectory = "") {
  const directory = relativeDirectory ? join(root, ...relativeDirectory.split("/")) : root;
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const normalized = normalizeRelativePath(relativePath);
    if (hostingSecretName.test(normalized)) throw new Error(`Refusing to publish secret-like artifact path: ${normalized}.`);
    const target = join(root, ...normalized.split("/"));
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error(`Static hosting artifacts cannot contain a symbolic link: ${normalized}.`);
    if (info.isDirectory()) {
      files.push(...await collectHostingFiles(root, normalized));
      continue;
    }
    if (!info.isFile()) throw new Error(`Static hosting artifacts can contain files only: ${normalized}.`);
    if (info.size > maxHostingFileBytes) throw new Error(`Static hosting artifact file exceeds ${maxHostingFileBytes} bytes: ${normalized}.`);
    const content = await readFile(target);
    files.push({
      path: normalized,
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      contentBase64: content.toString("base64"),
    });
  }
  return files;
}

export async function prepareStaticHostingArtifact(directoryValue) {
  const { directory, project } = await requiredProject(directoryValue);
  const output = await pathInsideProject(directory, staticArtifactContract.outputDirectory);
  const outputInfo = await lstat(output.target);
  if (outputInfo.isSymbolicLink() || !outputInfo.isDirectory()) throw new Error("The static hosting output must be a real out directory.");
  const files = await collectHostingFiles(output.target);
  if (!files.length || !files.some((file) => file.path === "index.html")) {
    throw new Error(`Build a static site with ${staticArtifactContract.outputDirectory}/index.html before publishing.`);
  }
  if (files.length > maxHostingFiles) throw new Error(`Static hosting artifacts cannot exceed ${maxHostingFiles} files.`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > maxHostingArtifactBytes) throw new Error(`Static hosting artifacts cannot exceed ${maxHostingArtifactBytes} bytes.`);
  const digest = createHash("sha256")
    .update(files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n"))
    .digest("hex");
  return {
    protocol: staticArtifactContract.protocol,
    projectId: project.id,
    digest,
    fileCount: files.length,
    totalBytes,
    files,
  };
}

export async function prepareDynamicHostingArtifact(directoryValue) {
  const { directory, project } = await requiredProject(directoryValue);
  const worker = await pathInsideProject(directory, dynamicArtifactContract.entrypoint);
  const info = await lstat(worker.target);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`The dynamic hosting artifact must be a real ${dynamicArtifactContract.entrypoint} file.`);
  if (info.size > dynamicArtifactContract.clientLimits.bytes) throw new Error(`The dynamic Worker module cannot exceed ${dynamicArtifactContract.clientLimits.bytes} bytes.`);
  const code = await readFile(worker.target, "utf8");
  const bytes = Buffer.byteLength(code, "utf8");
  return {
    protocol: dynamicArtifactContract.protocol,
    projectId: project.id,
    code,
    bytes,
    sha256: createHash("sha256").update(code).digest("hex"),
  };
}

export async function cloudflareTemporaryDeploySpec(directoryValue, nameValue, runtimeValue = "static") {
  const { directory, project } = await requiredProject(directoryValue);
  const runtime = runtimeValue === "dynamic" ? "dynamic" : "static";
  if (runtime === "dynamic") await prepareDynamicHostingArtifact(directory);
  else await prepareStaticHostingArtifact(directory);
  const configDirectory = join(directory, runtimeDirectoryName, "cloudflare-temporary");
  const configPath = join(configDirectory, "wrangler.jsonc");
  const runtimeConfig = runtime === "dynamic"
    ? { main: relative(configDirectory, join(directory, dynamicArtifactContract.entrypoint)).split(sep).join("/") }
    : {
        assets: {
          directory: join(directory, staticArtifactContract.outputDirectory),
          not_found_handling: "single-page-application",
        },
      };
  await atomicWrite(configPath, `${JSON.stringify({
    name: cleanDeploymentName(nameValue || project.name),
    compatibility_date: "2026-06-19",
    ...runtimeConfig,
  }, null, 2)}\n`);
  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["--yes", `wrangler@^${cachedContract.temporaryDeploy.minimumWranglerVersion}`, "deploy", "--temporary", "--config", configPath],
    cwd: directory,
    shell: false,
  };
}

function safeCommandEnvironment() {
  const allowedKeys = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec", "PATHEXT", "LANG", "LC_ALL", "TERM", "CI"];
  return Object.fromEntries(allowedKeys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}

export async function deployCloudflareTemporaryApp(input) {
  requireConfirmation(input?.confirmation, APP_BUILDER_CONFIRMATIONS.temporaryDeploy);
  const spec = await cloudflareTemporaryDeploySpec(input?.directory, input?.name, input?.runtime);
  const temporaryHome = await mkdtemp(join(tmpdir(), "hivemindos-cloudflare-temporary-"));
  try {
    const result = await execFileAsync(spec.command, spec.args, {
      cwd: spec.cwd,
      env: {
        ...safeCommandEnvironment(),
        HOME: temporaryHome,
        XDG_CONFIG_HOME: join(temporaryHome, ".config"),
      },
      timeout: 600_000,
      maxBuffer: maxCommandOutputBytes,
      windowsHide: true,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    const deploymentUrl = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev(?:\/[^\s]*)?/i)?.[0] || "";
    const claimUrl = output.match(/https:\/\/dash\.cloudflare\.com\/claim-preview\?claimToken=[^\s]+/i)?.[0] || "";
    if (!deploymentUrl) throw new Error("Cloudflare temporary deployment completed without a preview URL.");
    return { deploymentUrl, claimUrl, expiresInSeconds: cachedContract.temporaryDeploy.claimWindowSeconds };
  } finally {
    await rm(temporaryHome, { recursive: true, force: true });
  }
}

export async function runLocalAppBuilderAction(input) {
  const action = String(input?.action || "").trim();
  if (action === "create") return createLocalAppProject(input);
  if (action === "adopt") return adoptLocalAppProject(input);
  if (action === "get" || action === "status") return { project: await getLocalAppProject(input) };
  if (action === "files_tree") return listLocalAppFiles(input);
  if (action === "files_read") return readLocalAppFile(input);
  if (action === "files_write") return writeLocalAppFile(input);
  if (action === "files_rename") return renameLocalAppFile(input);
  if (action === "files_delete") return deleteLocalAppFile(input);
  if (action === "install") return installLocalAppDependencies(input);
  if (action === "start") return startLocalAppProject(input);
  if (action === "stop") return stopLocalAppProject(input);
  if (action === "artifact_prepare") return {
    artifact: input?.runtime === "dynamic"
      ? await prepareDynamicHostingArtifact(input?.directory)
      : await prepareStaticHostingArtifact(input?.directory),
  };
  if (action === "test_deploy") return deployCloudflareTemporaryApp(input);
  throw new Error("Unsupported local app-builder action.");
}
