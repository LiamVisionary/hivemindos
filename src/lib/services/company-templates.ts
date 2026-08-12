import type { CompanyTemplate, CompanyTemplateHostedRail } from "@/lib/types/company-template";

// The company template catalog: one-step starts for the business shapes the
// packaged skills, GTM banks (workflows/gtm/*), and hosted rails already
// support. Everything here references things that exist — a skill slug that
// ships in packaged-skills/, a GTM bank folder in workflows/gtm/, a hosted
// serviceId from the commercial catalog. Add templates by extending this
// matrix (never a parallel map; see AGENTS.md → Canonical Helpers).
//
// Design notes, learned from the first live company (WEBS):
// - Every template declares its credential manifest UP FRONT (setupKeys):
//   reactive key discovery stalled WEBS's whole revenue funnel for 14 days.
// - Approval posture defaults to "ask" for outbound; autonomyPause is explicit
//   so a template company can never balloon to 100+ unanswered asks.
// - Products ship as editable defaults — fixed-price packages close without a
//   human quote (WEBS decision 2026-07-02), so templates that sell include one.

// The hosted email rail (hivemindos-email-gateway, catalog id "outbound-email"):
// per-send pricing on the platform's SES domain with the CAN-SPAM footer,
// one-click unsubscribe, bounce/complaint suppression, and daily send budgets
// all enforced server-side — so outbound templates need neither an AgentMail
// key nor a company mailing address when the operator picks it.
const OUTBOUND_EMAIL_HOSTED_RAIL: CompanyTemplateHostedRail = {
  serviceId: "outbound-email",
  label: "Hosted outreach email",
  note: "Send outreach through the platform email rail — priced per send, with the CAN-SPAM footer, one-click unsubscribe, bounce/complaint suppression, and daily send budgets handled server-side. No email provider key or mailing address to set up.",
  replacesEnvKeys: ["OUTREACH_PHYSICAL_ADDRESS", "AGENTMAIL_API_KEY"],
};

const OUTBOUND_SETUP_KEYS: CompanyTemplate["setupKeys"] = [
  {
    envKey: "OUTREACH_PHYSICAL_ADDRESS",
    title: "Mailing address for outreach email footers",
    explanation:
      "US anti-spam law (CAN-SPAM) requires a physical postal address in every cold email, so sends stay paused until this is set. A PO box or mailbox service works.",
    kind: "text",
    placeholder: "123 Main St, Suite 200, Sarasota, FL 34236",
    links: [{ label: "CAN-SPAM compliance guide", url: "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business" }],
    requiredForLaunch: true,
    hostedAlternative: "outbound-email",
  },
  {
    envKey: "AGENTMAIL_API_KEY",
    title: "Connect an email-sending provider",
    explanation: "The crew sends and reads outreach through AgentMail. Paste an API key so agents can operate the company inbox.",
    kind: "secret",
    placeholder: "Paste the AgentMail API key",
    links: [{ label: "AgentMail", url: "https://agentmail.to" }],
    requiredForLaunch: true,
    hostedAlternative: "outbound-email",
  },
  {
    envKey: "STRIPE_SECRET_KEY",
    title: "Connect Stripe to take payments",
    explanation: "Without a payment rail the crew can book calls but never close revenue. Paste a Stripe secret key to turn on checkout links.",
    kind: "secret",
    placeholder: "sk_live_…",
    links: [{ label: "Stripe API keys", url: "https://dashboard.stripe.com/apikeys" }],
    requiredForLaunch: false,
  },
];

export const COMPANY_TEMPLATE_MATRIX: readonly CompanyTemplate[] = [
  {
    id: "local-website-agency",
    name: "Local Website Agency",
    emoji: "🌐",
    tagline: "Find local businesses with weak websites, build previews, pitch, and close fixed-price builds.",
    sector: "Web Development",
    archetype: "service-company",
    goalSeed: "Earn $5k/week building and shipping websites for local businesses in my city, closing fixed-price packages without human intervention.",
    charter:
      "Run an autonomous local web agency: research businesses with weak or missing websites, build reviewable preview sites, pitch by approved email, follow through to booked, paying clients. Quote only the official product catalog. All customer-facing sends and publishes require approval until the operator loosens the policy. Surface missing credentials as setup blockers — never work around a compliance gate.",
    apexGoal: { title: "Weekly revenue from shipped websites", metric: "Weekly Revenue", target: "5k", unit: "currency" },
    products: [
      { key: "starter-launch", name: "Starter Launch", amountUsd: 1_500, description: "One-page site, mobile-ready, live in 5 business days.", kind: "package" },
      { key: "standard-growth", name: "Standard Growth Site", amountUsd: 3_000, description: "Multi-page site with booking and lead capture.", recommended: true, kind: "package" },
      { key: "premium-booking-seo", name: "Premium Booking + SEO Engine", amountUsd: 5_000, description: "Full site, booking flow, and a local-SEO foundation.", kind: "package" },
      { key: "care-plan", name: "Hosting & care plan", amountUsd: 99, interval: "month", kind: "addon", description: "Hosting, updates, and small changes." },
    ],
    directives: [
      { text: "Qualify prospects with evidence (weak/missing site, reviews, activity) before any pitch; a concrete preview beats a generic pitch.", skills: ["small-business-preview-engine", "outreach-brief-gtm"] },
      { text: "Build each prospect site from the company's linked website-template project: record the selected vertical/template, then customize the full page system around verified business details, reviews, services, imagery, layout, and calls to action. A generic card, copy-only mockup, or shared shell with only colors and names changed is not a website deliverable.", skills: ["small-business-preview-engine"] },
      { text: "A prospect packet is incomplete until it contains a browser-verified public website URL, a Loom-style walkthrough recorded from that exact site, the approved reusable founder-introduction clip combined with the walkthrough, and an email draft ordered website → video → purchase-or-book link. If the founder clip is missing, surface FOUNDER_INTRO_VIDEO as a setup blocker; never silently omit it. Publishing and sending remain approval-gated." },
      { text: "Write outreach with the cold-email playbook: verified sends, deliverability rules, one clear CTA, no placeholder text.", skills: ["cold-email-gtm"] },
      { text: "Put hard budget guardrails on any paid discovery API before the first call — set provider-side daily caps, never rely on in-loop restraint.", skills: ["google-api-budget-guardrails"] },
      { text: "Before requesting send approval, open the exact public site and media, verify desktop and mobile layout, wrong-shell/template similarity, placeholder leakage, video playback, and every preview, booking, and checkout link end-to-end." },
    ],
    autonomyPause: { maxWaitingOnHuman: 12 },
    budgetTier: "starter",
    setupKeys: [
      ...OUTBOUND_SETUP_KEYS,
      {
        envKey: "GOOGLE_MAPS_API_KEY",
        title: "Google Places key for prospect discovery (optional)",
        explanation: "Enables automated local-business discovery with your own key. Apply the budget-guardrails skill first — uncapped Places usage once burned ~$1.8k/month. The hosted lead-gen rail replaces this key entirely with server-side budget caps.",
        kind: "secret",
        placeholder: "Paste the Google Maps Platform key",
        links: [{ label: "Google Maps Platform", url: "https://console.cloud.google.com/google/maps-apis" }],
        requiredForLaunch: false,
        hostedAlternative: "leadgen-data",
      },
      {
        envKey: "FOUNDER_INTRO_VIDEO",
        title: "Add the reusable founder-introduction video",
        explanation: "Provide an approved local file path or HTTPS URL for the short founder introduction that precedes each prospect's site walkthrough. The crew may build and review sites without it, but it must not send an outreach packet that silently omits the founder introduction.",
        kind: "text",
        placeholder: "/path/to/founder-intro.mp4 or https://…/founder-intro.mp4",
        requiredForLaunch: false,
      },
    ],
    skills: ["small-business-preview-engine", "cold-email-gtm", "outreach-brief-gtm", "google-api-budget-guardrails", "google-business-profile-public-audit", "self-serve-payment-funnel"],
    gtmPacks: ["cold-email", "outreach-brief"],
    hostedRails: [
      { serviceId: "app-hosting", label: "Hosted client sites & previews", note: "Publish preview and production sites on managed hosting with per-site access controls — no DNS or server setup per client." },
      { serviceId: "leadgen-data", label: "Hosted local-business discovery", note: "Discover and enrich local-business leads through the managed data rail — no Google key, priced per call with server-enforced daily budget caps (the structural fix for the raw-key runaway-spend failure mode).", replacesEnvKeys: ["GOOGLE_MAPS_API_KEY"] },
      OUTBOUND_EMAIL_HOSTED_RAIL,
    ],
  },
  {
    id: "content-studio",
    name: "Content Studio",
    emoji: "🎬",
    tagline: "Produce and publish a repeatable content format — video, posts, or a newsletter — that grows an audience.",
    sector: "Media & Content",
    archetype: "content-company",
    goalSeed: "Grow an audience to 10k subscribers by producing a consistent, high-quality content format every week.",
    charter:
      "Run an autonomous content studio: research audience signals, produce a repeatable content format, QA for originality and accuracy, and package publish-ready drops. Publishing to any external platform requires approval until the operator loosens the policy. Voice and brand files are the source of truth for tone.",
    apexGoal: { title: "Audience growth", metric: "Subscribers", target: "10k", unit: "users" },
    directives: [
      { text: "Build the voice foundation first (about/voice/brand brief) and read it before generating any content.", skills: ["b2b-social-gtm"] },
      { text: "Plan distribution with the organic-reach pillars; every piece needs an audience-specific hook, not a broad summary.", skills: ["organic-reach-gtm"] },
      { text: "For video: script tight, cut for the platform, and QA renders before packaging.", skills: ["script-to-short", "social-video-publishing"] },
    ],
    autonomyPause: { maxWaitingOnHuman: 12 },
    budgetTier: "starter",
    setupKeys: [],
    skills: ["b2b-social-gtm", "organic-reach-gtm", "script-to-short", "social-video-publishing", "viral-startup-launch-video"],
    gtmPacks: ["organic-reach", "b2b-social"],
    hostedRails: [
      { serviceId: "media-studio", label: "Hosted image & video generation", note: "Generate imagery and video through the paid media rail — no provider keys, budgeted per generation." },
      { serviceId: "x-studio", label: "X content tooling", note: "Style profiles, engagement audits, and voice-bank batches for X-first formats." },
    ],
  },
  {
    id: "outbound-leadgen-agency",
    name: "Outbound Lead-Gen Agency",
    emoji: "🎯",
    tagline: "Multi-channel outbound — email, LinkedIn, X — that books qualified calls for a defined offer.",
    sector: "Professional Services",
    archetype: "service-company",
    goalSeed: "Book 10 qualified sales calls per week for my offer through approved multi-channel outbound.",
    charter:
      "Run an autonomous outbound agency: build the offer brief, research qualified prospects with evidence, draft channel-correct outreach, and queue every outbound item for approval. Respect platform caps from the playbooks as hard ceilings. No send happens without an approved draft until the operator explicitly authorizes an automated path.",
    apexGoal: { title: "Qualified calls booked weekly", metric: "Booked Calls / Week", target: "10", unit: "number" },
    directives: [
      { text: "The offer brief is the company's constitution — build it first, read it before any outreach batch.", skills: ["outreach-brief-gtm"] },
      { text: "Email: follow the cold-email spine (verification, deliverability, sequences); LinkedIn and X: warm before you pitch, stay inside daily caps.", skills: ["cold-email-gtm", "linkedin-gtm", "x-warm-outreach-gtm"] },
      { text: "Batch outbound drafts into one daily review queue per channel instead of one-off asks." },
    ],
    autonomyPause: { maxWaitingOnHuman: 15 },
    budgetTier: "starter",
    setupKeys: OUTBOUND_SETUP_KEYS,
    skills: ["outreach-brief-gtm", "cold-email-gtm", "linkedin-gtm", "x-warm-outreach-gtm", "self-serve-payment-funnel"],
    gtmPacks: ["cold-email", "outreach-brief", "linkedin", "x-warm-outreach"],
    hostedRails: [OUTBOUND_EMAIL_HOSTED_RAIL],
  },
  {
    id: "research-intelligence",
    name: "Research & Intelligence Service",
    emoji: "🔎",
    tagline: "Sell evidence-backed research reports: market questions in, verified answers out.",
    sector: "Research & Intelligence",
    archetype: "research-company",
    goalSeed: "Earn $2k/month selling evidence-backed research reports with reproducible sourcing.",
    charter:
      "Run an autonomous research service: take bounded questions, gather primary evidence, adversarially verify claims, and deliver decision-ready reports with a source register. Never ship an unverified claim; label confidence honestly. Selling or publishing a report requires approval.",
    apexGoal: { title: "Monthly research revenue", metric: "MRR", target: "2k", unit: "currency" },
    products: [
      { key: "voc-snapshot", name: "Voice-of-customer snapshot", amountUsd: 149, description: "What real users say about a product/market, with quotes and sources.", kind: "package" },
      { key: "deep-report", name: "Deep research report", amountUsd: 499, description: "Multi-source verified report on one bounded question.", recommended: true, kind: "package" },
    ],
    directives: [
      { text: "Structure every engagement with the STORM method: outline from sources, verify, then write.", skills: ["storm-research"] },
      { text: "For product/market questions, mine real user voice first (forums, reviews, communities) before any synthesis.", skills: [] },
      { text: "Every report ships with a source-and-assumption register; separate confirmed findings from inferences." },
    ],
    autonomyPause: { maxWaitingOnHuman: 10 },
    budgetTier: "starter",
    setupKeys: [],
    skills: ["storm-research", "product-analytics-audit"],
    gtmPacks: ["outreach-brief"],
    hostedRails: [
      { serviceId: "reddit-voc", label: "Hosted Reddit voice-of-customer", note: "Evidence-linked VOC snapshots and deep runs, priced per run — no Reddit scraping setup." },
      { serviceId: "hive-research", label: "Hosted deep research", note: "Score-first verified research runs as a metered production input." },
    ],
  },
  {
    id: "local-seo-agency",
    name: "Local SEO & Reviews Agency",
    emoji: "📍",
    tagline: "Keep local businesses visible: Google Business Profile audits, post calendars, review responses.",
    sector: "Local Marketing",
    archetype: "service-company",
    goalSeed: "Earn $3k/month in recurring local-SEO retainers for businesses in my city.",
    charter:
      "Run an autonomous local-presence agency: audit Google Business Profiles from public signals, produce post calendars and review-response drafts, and package them as a monthly retainer. Everything customer-visible ships as an approval-gated draft. Never fabricate reviews or post on a client's behalf without authorization.",
    apexGoal: { title: "Recurring retainer revenue", metric: "MRR", target: "3k", unit: "currency" },
    products: [
      { key: "gbp-audit", name: "Local presence audit", amountUsd: 250, description: "Full public audit of the business's local search presence, with fixes ranked.", kind: "package" },
      { key: "local-retainer", name: "Local visibility retainer", amountUsd: 399, interval: "month", description: "Monthly posts, review responses, and presence upkeep.", recommended: true, kind: "package" },
    ],
    directives: [
      { text: "Audit from public signals only; rank fixes by impact and make the audit itself the pitch.", skills: ["google-business-profile-public-audit"] },
      { text: "Produce post calendars and review responses as batched drafts in the client's brand voice.", skills: ["local-gbp-posts-calendar", "local-review-response-templates"] },
    ],
    autonomyPause: { maxWaitingOnHuman: 12 },
    budgetTier: "local-free",
    setupKeys: OUTBOUND_SETUP_KEYS.slice(0, 2),
    skills: ["google-business-profile-public-audit", "local-gbp-posts-calendar", "local-review-response-templates", "cold-email-gtm"],
    gtmPacks: ["cold-email"],
    hostedRails: [
      { serviceId: "leadgen-data", label: "Hosted local-business discovery", note: "Find and qualify local-business prospects through the managed data rail — no Google key, priced per call with server-enforced daily budget caps.", replacesEnvKeys: ["GOOGLE_MAPS_API_KEY"] },
      OUTBOUND_EMAIL_HOSTED_RAIL,
    ],
  },
  {
    id: "saas-product-studio",
    name: "SaaS Product Studio",
    emoji: "🛠️",
    tagline: "Build a small software product to first revenue: working increments, landing page, launch, first customers.",
    sector: "Software & Digital Products",
    archetype: "product-company",
    goalSeed: "Ship a small software product and reach $1k MRR from real customers.",
    charter:
      "Run an autonomous product studio: build in small verified increments, keep a working preview at all times, and drive toward first paying customers. Deployments to production and anything customer-visible require approval. Evidence gates decide done — never self-report a working product without a live check.",
    apexGoal: { title: "Product revenue", metric: "MRR", target: "1k", unit: "currency" },
    directives: [
      { text: "Landing page and positioning follow the viral-product principles; ship the smallest inspectable increment first.", skills: ["viral-product-landing-page"] },
      { text: "Run the customer-acquisition sprint once a preview exists — real users before more features.", skills: ["startup-customer-acquisition-sprint"] },
      { text: "Wire self-serve checkout early so revenue needs no human in the loop.", skills: ["self-serve-payment-funnel"] },
    ],
    autonomyPause: { maxWaitingOnHuman: 12 },
    budgetTier: "starter",
    setupKeys: [OUTBOUND_SETUP_KEYS[2]],
    skills: ["viral-product-landing-page", "startup-customer-acquisition-sprint", "self-serve-payment-funnel", "viral-startup-launch-video"],
    gtmPacks: ["organic-reach"],
    hostedRails: [
      { serviceId: "app-hosting", label: "Hosted product deployment", note: "Ship the product and its landing page on managed hosting with rollback — no infra setup." },
    ],
  },
] as const;

export function companyTemplateById(id: string | undefined | null): CompanyTemplate | undefined {
  if (!id) return undefined;
  return COMPANY_TEMPLATE_MATRIX.find((template) => template.id === id.trim());
}

/** Catalog view for pickers: everything except the long-form seeds. */
export function companyTemplateCatalog() {
  return COMPANY_TEMPLATE_MATRIX.map((template) => ({
    id: template.id,
    name: template.name,
    emoji: template.emoji,
    tagline: template.tagline,
    sector: template.sector,
    goalSeed: template.goalSeed,
    budgetTier: template.budgetTier,
    productCount: template.products?.length ?? 0,
    skillCount: template.skills.length,
    setupKeyCount: template.setupKeys.length,
    requiredSetupKeys: template.setupKeys.filter((key) => key.requiredForLaunch).map((key) => key.envKey),
    hostedRails: template.hostedRails.map((rail) => ({ serviceId: rail.serviceId, label: rail.label })),
  }));
}
