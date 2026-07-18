#!/usr/bin/env node
// Hermetic: the company template catalog stays real — every template's
// archetype, packaged-skill slug, and GTM bank must exist in this repo, its
// governance posture must be safe (backpressure on, finite budget tier), and
// the founder compiler must honor a picked template. Templates that reference
// things that don't ship are worse than no templates: they found companies
// whose playbooks dangle.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

register(new URL("./lib/ts-relative-loader.mjs", import.meta.url));

const ROOT = new URL("..", import.meta.url).pathname;

const { COMPANY_TEMPLATE_MATRIX, companyTemplateById, companyTemplateCatalog } = await import("../src/lib/services/company-templates.ts");
const { FOUNDER_ARCHETYPE_MATRIX, compileFounderBlueprint } = await import("../src/lib/services/founder-blueprint.ts");
const { reconcileProposalAgainstTask } = await import("../src/lib/services/company-needs-human-triage.ts");
void reconcileProposalAgainstTask; // co-located import sanity: triage module loads under the same loader

// ── catalog integrity ────────────────────────────────────────────────────────
assert.ok(COMPANY_TEMPLATE_MATRIX.length >= 5, "the catalog offers a real variety of company shapes");
const ids = COMPANY_TEMPLATE_MATRIX.map((template) => template.id);
assert.equal(new Set(ids).size, ids.length, "template ids are unique");

const archetypeIds = new Set(FOUNDER_ARCHETYPE_MATRIX.map((entry) => entry.id));

function packagedSkillExists(slug) {
  for (const tier of ["auto-install", "optional"]) {
    const base = join(ROOT, "packaged-skills", tier);
    if (existsSync(join(base, slug, "SKILL.md"))) return true;
    // optional skills nest one category + one source dir deep (e.g. gtm/hivemindos/<slug>)
    for (const category of ["gtm", "ops", "media", "research", "design", "brand", "crypto", "events", "n8n", "engineering"]) {
      for (const source of ["hivemindos", "mikefutia", "athm793"]) {
        if (existsSync(join(base, category, source, slug, "SKILL.md"))) return true;
      }
    }
  }
  return false;
}

for (const template of COMPANY_TEMPLATE_MATRIX) {
  const label = `template ${template.id}`;
  assert.ok(archetypeIds.has(template.archetype), `${label}: archetype "${template.archetype}" exists in FOUNDER_ARCHETYPE_MATRIX`);
  assert.ok(template.goalSeed.length >= 12, `${label}: goalSeed long enough for the founder compiler`);
  assert.ok(template.charter.length > 80, `${label}: charter is a real operating contract`);

  // Governance posture: no template may found a company that can balloon
  // unanswered asks or spend without a ceiling.
  assert.ok(
    (template.autonomyPause?.maxWaitingOnHuman ?? 0) > 0,
    `${label}: autonomyPause backpressure must be explicitly on`,
  );
  assert.ok(["local-free", "starter", "growth", "scale"].includes(template.budgetTier), `${label}: known budget tier`);

  // Every referenced skill ships in packaged-skills (auto-install or optional).
  const slugs = new Set([...template.skills, ...template.directives.flatMap((directive) => directive.skills ?? [])]);
  for (const slug of slugs) {
    assert.ok(packagedSkillExists(slug), `${label}: referenced skill "${slug}" must exist under packaged-skills/`);
  }

  // Every GTM pack points at a real bank.
  for (const pack of template.gtmPacks) {
    assert.ok(
      existsSync(join(ROOT, "workflows", "gtm", pack, "templates.json")),
      `${label}: gtm pack "${pack}" must exist at workflows/gtm/${pack}/templates.json`,
    );
  }

  // Setup keys: uppercase env names, operator copy, no value-looking content.
  for (const key of template.setupKeys) {
    assert.match(key.envKey, /^[A-Z][A-Z0-9_]{1,80}$/, `${label}: setup key "${key.envKey}" is an env-style name`);
    assert.ok(key.explanation.length > 20, `${label}: ${key.envKey} explains what it unlocks`);
    assert.ok(!/sk_live_[0-9a-zA-Z]{8,}/.test(key.placeholder ?? ""), `${label}: placeholder never looks like a real secret`);
  }

  // Products (when sold) have positive prices and unique keys.
  const productKeys = (template.products ?? []).map((product) => product.key);
  assert.equal(new Set(productKeys).size, productKeys.length, `${label}: product keys unique`);
  for (const product of template.products ?? []) {
    assert.ok(product.amountUsd > 0, `${label}: ${product.key} has a positive price`);
  }

  // Hosted rails: unique service ids, operator copy, and internal consistency —
  // a rail's replacesEnvKeys and a setup key's hostedAlternative must point at
  // each other, never dangle.
  const railServiceIds = template.hostedRails.map((rail) => rail.serviceId);
  assert.equal(new Set(railServiceIds).size, railServiceIds.length, `${label}: hosted rail service ids unique`);
  for (const rail of template.hostedRails) {
    assert.match(rail.serviceId, /^[a-z][a-z0-9-]{1,60}$/, `${label}: rail "${rail.serviceId}" is a catalog-style service id`);
    assert.ok(rail.label.length > 3 && rail.note.length > 20, `${label}: rail ${rail.serviceId} carries operator copy`);
    for (const envKey of rail.replacesEnvKeys ?? []) {
      assert.match(envKey, /^[A-Z][A-Z0-9_]{1,80}$/, `${label}: rail ${rail.serviceId} replaces an env-style key`);
    }
  }
  for (const key of template.setupKeys) {
    if (!key.hostedAlternative) continue;
    assert.ok(
      railServiceIds.includes(key.hostedAlternative),
      `${label}: ${key.envKey} hostedAlternative "${key.hostedAlternative}" must be one of the template's hosted rails`,
    );
    const rail = template.hostedRails.find((entry) => entry.serviceId === key.hostedAlternative);
    assert.ok(
      (rail?.replacesEnvKeys ?? []).includes(key.envKey),
      `${label}: rail ${key.hostedAlternative} must declare it replaces ${key.envKey}`,
    );
  }
}

// The lead-gen data rail is the structural fix for raw-key Google Places
// runaway spend: both local templates must offer it, and the website agency's
// GOOGLE_MAPS_API_KEY setup key must name it as the hosted alternative.
for (const templateId of ["local-website-agency", "local-seo-agency"]) {
  const template = COMPANY_TEMPLATE_MATRIX.find((entry) => entry.id === templateId);
  const rail = template?.hostedRails.find((entry) => entry.serviceId === "leadgen-data");
  assert.ok(rail, `${templateId} offers the leadgen-data hosted rail`);
  assert.deepEqual(rail.replacesEnvKeys, ["GOOGLE_MAPS_API_KEY"], `${templateId} rail replaces the raw Google key`);
}
{
  const website = COMPANY_TEMPLATE_MATRIX.find((entry) => entry.id === "local-website-agency");
  const mapsKey = website?.setupKeys.find((key) => key.envKey === "GOOGLE_MAPS_API_KEY");
  assert.equal(mapsKey?.hostedAlternative, "leadgen-data", "GOOGLE_MAPS_API_KEY names the hosted rail that replaces it");
}

// The outbound-email rail is the hosted fix for per-company email setup (the
// CAN-SPAM address that once held 96 sends for 14 days, plus the AgentMail
// key) and for the platform-wide zero-bounce-processing gap: every outbound
// template must offer it, replacing both launch-blocking email keys.
for (const templateId of ["local-website-agency", "outbound-leadgen-agency", "local-seo-agency"]) {
  const template = COMPANY_TEMPLATE_MATRIX.find((entry) => entry.id === templateId);
  const rail = template?.hostedRails.find((entry) => entry.serviceId === "outbound-email");
  assert.ok(rail, `${templateId} offers the outbound-email hosted rail`);
  assert.deepEqual(
    rail.replacesEnvKeys,
    ["OUTREACH_PHYSICAL_ADDRESS", "AGENTMAIL_API_KEY"],
    `${templateId} rail replaces the CAN-SPAM address and the provider key`,
  );
}

// ── lookup + catalog view ────────────────────────────────────────────────────
assert.equal(companyTemplateById("local-website-agency")?.name, "Local Website Agency");
assert.equal(companyTemplateById("nope"), undefined);
assert.equal(companyTemplateById(undefined), undefined);
const catalog = companyTemplateCatalog();
assert.equal(catalog.length, COMPANY_TEMPLATE_MATRIX.length);
assert.ok(catalog.every((entry) => entry.id && entry.name && entry.tagline && entry.goalSeed), "catalog rows carry picker fields");
const agency = catalog.find((entry) => entry.id === "local-website-agency");
assert.deepEqual(
  agency?.requiredSetupKeys,
  ["OUTREACH_PHYSICAL_ADDRESS", "AGENTMAIL_API_KEY"],
  "catalog surfaces the launch-required keys so the picker can show real setup cost",
);

// ── founder compiler honors the template ─────────────────────────────────────
const template = companyTemplateById("local-website-agency");
const blueprint = compileFounderBlueprint({
  goal: "Earn $5k/week building websites for Sarasota businesses",
  constraints: { privacy: "private-first", budgetTier: "starter", pace: "week" },
  template,
  now: "2026-07-16T12:00:00.000Z",
});
assert.equal(blueprint.templateId, "local-website-agency");
assert.equal(blueprint.archetype, "service-company", "template forces its archetype regardless of goal regexes");
assert.equal(blueprint.identity.sector, "Web Development");
assert.equal(blueprint.apexGoal.metric, "Weekly Revenue", "template metric wins over goal-text heuristics");
assert.equal(blueprint.apexGoal.unit, "currency");
assert.equal(blueprint.identity.charter, template.charter, "template charter is the operating contract");
assert.equal(blueprint.apexGoal.title.includes("Sarasota"), true, "the goal stays the user's own words");

// Without a template the old regex path is untouched.
const untouched = compileFounderBlueprint({
  goal: "Build a research intelligence report business earning $2k",
  constraints: { privacy: "private-first", budgetTier: "local-free", pace: "week" },
  now: "2026-07-16T12:00:00.000Z",
});
assert.equal(untouched.templateId, undefined);
assert.ok(untouched.archetype.length > 0);

console.log("PASS test-company-templates");
process.exit(0);
