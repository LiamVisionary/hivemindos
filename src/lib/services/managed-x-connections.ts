export type ManagedXConnectionRecord = Record<string, unknown>;

export function managedXConnectionId(connection: ManagedXConnectionRecord): string {
  for (const key of ["slug", "connectionSlug", "id"]) {
    const value = connection[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function managedXConnectionHandle(connection: ManagedXConnectionRecord): string {
  for (const key of ["handle", "username", "screenName", "xUsername", "accountHandle"]) {
    const value = connection[key];
    if (typeof value === "string" && value.trim()) return value.trim().replace(/^@/, "");
  }
  return "";
}

export function managedXConnectionsFromPayload(payload: unknown): ManagedXConnectionRecord[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const connections = (payload as { connections?: unknown }).connections;
  return Array.isArray(connections)
    ? connections.filter((connection): connection is ManagedXConnectionRecord => Boolean(connection) && typeof connection === "object" && !Array.isArray(connection))
    : [];
}
