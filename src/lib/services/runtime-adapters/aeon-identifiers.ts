const AEON_SKILL_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

export function isValidAeonSkillSlug(value: unknown): value is string {
  return typeof value === "string" && AEON_SKILL_SLUG_PATTERN.test(value);
}
