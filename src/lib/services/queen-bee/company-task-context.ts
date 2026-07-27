/** The company id stamped on a company dispatch source (`company:{id}:{runId}`). */
export function companyIdFromSource(source?: string | null): string | null {
  if (!source || !source.startsWith("company:")) return null;
  return source.split(":")[1] || null;
}
