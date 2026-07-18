import type { CompanyApprovalPolicy, CompanyAutonomyPause, CompanyProduct } from "@/lib/types/company";
import type { FounderBudgetTier } from "@/lib/types/founder-blueprint";

/**
 * A shared-env key a company template knows it will need. Declared keys drive
 * the PROACTIVE setup checklist: the SetupBlockerBand can show "paste this to
 * unblock X" at creation time instead of after the crew silently stalls on it
 * (live failure mode: one unset CAN-SPAM address held 96 outreach emails for
 * 14 days while surfacing only as scattered needs-human prose).
 */
export interface CompanyTemplateSetupKey {
  /** Shared hive-env key, e.g. OUTREACH_PHYSICAL_ADDRESS. */
  envKey: string;
  /** Short human title for the checklist card. */
  title: string;
  /** Why the crew needs it and what pasting it unlocks. */
  explanation: string;
  /** "secret" masks the input; "text" (an address, a city) shows it plainly. */
  kind: "secret" | "text";
  placeholder: string;
  links?: Array<{ label: string; url: string }>;
  /**
   * True = the company's core loop cannot produce value without it (surface at
   * creation). False/absent = deferred: it surfaces only once work first needs it.
   */
  requiredForLaunch?: boolean;
  /** Hosted-service id that removes this key entirely when the user picks the hosted rail. */
  hostedAlternative?: string;
}

/** A hosted HivemindOS service this template can lean on instead of BYO keys/infra. */
export interface CompanyTemplateHostedRail {
  /** Commercial catalog service id (e.g. "app-hosting", "media-studio", "reddit-voc"). */
  serviceId: string;
  label: string;
  /** What the rail does for this company, in operator language. */
  note: string;
  /** Declared setup keys this rail makes unnecessary. */
  replacesEnvKeys?: string[];
}

/** A standing directive seeded into the company at founding (skills ride into every task). */
export interface CompanyTemplateDirective {
  text: string;
  /** Shared-shelf / packaged skill slugs the crew should read for this. */
  skills?: string[];
}

/**
 * One entry in the company template catalog: everything needed to go from
 * "I want this kind of business" to a configured, governed, launch-ready
 * company in one step — identity seeds, crew archetype, product catalog,
 * playbook directives, approval posture, budget tier, credential manifest,
 * and hosted rails. Follows the repo's capability-matrix convention: extend
 * the matrix, don't scatter conditionals.
 */
export interface CompanyTemplate {
  /** Stable slug, e.g. "local-website-agency". */
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  sector: string;
  /** Founder archetype id this template builds on (crew roles / deliverables). */
  archetype: string;
  /** Suggested goal text, shown pre-filled and editable ({{city}}-style hints stay human-editable prose). */
  goalSeed: string;
  /** Charter seed — the operating contract the crew runs under. */
  charter: string;
  apexGoal: { title: string; metric: string; target: string; unit: "number" | "percent" | "currency" | "users" };
  /** Default sellable catalog (operator edits prices before launch). */
  products?: CompanyProduct[];
  /** Standing playbook directives seeded at founding. */
  directives: CompanyTemplateDirective[];
  /** Extra approval policies beyond the founder defaults (merged by id). */
  approvalPolicies?: CompanyApprovalPolicy[];
  /** Backpressure default — explicit so operators SEE it, not just inherit it. */
  autonomyPause?: CompanyAutonomyPause;
  budgetTier: FounderBudgetTier;
  /** Credential manifest: what to set up, what each key unlocks, what hosted rails replace. */
  setupKeys: CompanyTemplateSetupKey[];
  /** Packaged / shared-shelf skill slugs that make this business run well. */
  skills: string[];
  /** workflows/gtm bank folders whose curated rows serve this business. */
  gtmPacks: string[];
  hostedRails: CompanyTemplateHostedRail[];
}
