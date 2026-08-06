const STANDARD_MARKDOWN_LINK_LEAD_PATTERN = /^\s*\[[^\]]+\]\s*\(/;
const OBSIDIAN_WIKILINK_LEAD_PATTERN = /^\s*\[\[[^\]\r\n]+\]\]/;
const OBSIDIAN_WIKILINK_PATTERN = /^\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/;

export function isMarkdownLinkLead(value: string) {
  return (
    STANDARD_MARKDOWN_LINK_LEAD_PATTERN.test(value) ||
    OBSIDIAN_WIKILINK_LEAD_PATTERN.test(value)
  );
}

export function parseObsidianWikilink(
  value: string,
): { label: string; target: string } | null {
  const match = OBSIDIAN_WIKILINK_PATTERN.exec(value.trim());
  if (!match) return null;
  const target = match[1].trim();
  if (!target) return null;
  const explicitLabel = match[2]?.trim();
  const label = explicitLabel || target.split("/").pop() || target;
  return { label, target };
}
