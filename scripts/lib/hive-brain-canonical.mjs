function keySegment(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

export function canonicalMemoryKey({ explicitKey, type, title, project }) {
  if (String(explicitKey ?? "").trim()) {
    return String(explicitKey)
      .split(/[/:]+/)
      .map(keySegment)
      .filter(Boolean)
      .join("/")
      .slice(0, 180);
  }
  return [type, project || "global", title]
    .map(keySegment)
    .filter(Boolean)
    .join("/")
    .slice(0, 180);
}

function recordTime(record) {
  const updated = Date.parse(record.updatedAt);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(record.createdAt);
  return Number.isFinite(created) ? created : 0;
}

export function selectCanonicalMemoryHeads(records) {
  const passthrough = records.filter((record) => record.status !== "active" || !record.memoryKey);
  const byKey = new Map();
  for (const record of records) {
    if (record.status !== "active" || !record.memoryKey) continue;
    byKey.set(record.memoryKey, [...(byKey.get(record.memoryKey) ?? []), record]);
  }
  const heads = [];
  const conflicts = [];
  for (const [memoryKey, group] of byKey) {
    const sorted = [...group].sort((left, right) => recordTime(right) - recordTime(left) || right.id.localeCompare(left.id));
    heads.push(sorted[0]);
    if (sorted.length > 1) conflicts.push({ memoryKey, headId: sorted[0].id, memberIds: sorted.map((record) => record.id) });
  }
  return { records: [...passthrough, ...heads], conflicts };
}
