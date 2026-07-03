// Per-company "output spec": what a Zero Human Company exists to PRODUCE, so the
// board can show real business outputs (the generated sites, the books, the
// clips) as the deliverables — and demote the RESULT.md / trackers / scratch
// files that merely *evidence* the work into a collapsed "Work log".
//
// This is the layer the old model was missing: the low-level classifier
// (deliverables-model.ts) types an artifact by FILE FORMAT ("this is a link / a
// report / a spreadsheet"); this module types it by BUSINESS PURPOSE for a
// specific company ("for a website agency, a preview link is the product; a
// tracker CSV is just work log"). Pure + React-free so it is hermetically
// testable. Recognition is deliberately heuristic (display-side); an explicit
// per-output emission contract can refine it later without changing this API.
import type { ClassifiedDeliverable, DeliverableIcon } from "./deliverables-model";

/** Where a deliverable shows up: the headline product, the comms tab, or the collapsed work log. */
export type OutputClass = "primary" | "comms" | "worklog";

export interface CompanyProfile {
  sector?: string;
  name?: string;
  /** The company's own description of itself — what it PRODUCES. Stable identity,
   *  NOT task titles (those describe activities and corrupt product detection). */
  blurb?: string;
  apexTitle?: string;
  apexMetric?: string;
  /** Recent activity / task titles. Used ONLY to detect outreach (a Comms tab),
   *  never to decide the product kind — task titles are too noisy for that. */
  activityText?: string;
}

export interface OutputSpec {
  /** Section header for the primary deliverables, e.g. "Websites your company built". */
  primaryLabel: string;
  primaryBlurb: string;
  /** Shown when the company hasn't produced a primary output yet. */
  emptyHint: string;
  /** True when the company communicates outward → the conditional Comms tab shows. */
  comms: boolean;
  commsLabel: string; // tab label, e.g. "Emails"
  commsBlurb: string;
  /** Which display bucket a classified deliverable belongs to for THIS company. */
  classOf(c: ClassifiedDeliverable): OutputClass;
}

// ── signal extraction ────────────────────────────────────────────────────────

/** Stable identity signal → what the company PRODUCES (never volatile task titles). */
function identityText(p: CompanyProfile): string {
  return `${p.sector ?? ""} ${p.name ?? ""} ${p.blurb ?? ""} ${p.apexTitle ?? ""} ${p.apexMetric ?? ""}`.toLowerCase();
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? "").toLowerCase();
}

/** A file that only *evidences* work — never the product — regardless of company. */
export function isWorkNote(c: ClassifiedDeliverable): boolean {
  const path = c.deliverable.path ?? "";
  const name = baseName(path);
  if (/^result\b/.test(name)) return true; // RESULT.md — the agent's own write-up
  if (/\b(receipt|verification|verify|status|logs?|notes?|scratch|state|manifest|checklist|plan|summary|report)\b/.test(name)) return true;
  if (/\/artifacts?\//i.test(path)) return true; // work-board scratch dir
  if (/\/(?:memory|distillations)\//i.test(path)) return true; // brain memory
  return false;
}

interface ProductKinds {
  siteLinks: boolean; // generated websites are the product
  documents: boolean; // books/ebooks/long-form are the product
  media: boolean; // clips / images / video are the product
  postLinks: boolean; // a link to where produced media went live (a social post) is the product
  paymentLinks: boolean; // a live checkout is itself the product
  bookingLinks: boolean;
}

function kindsFor(text: string): ProductKinds {
  const web = /\b(web|website|websites|site|sites|landing|page|pages|agency|seo|funnel|storefront|shopify|wordpress)\b/.test(text);
  const publishing = /\b(ebook|ebooks|book|books|publish|publishing|author|writing|writer|newsletter|blog|article|articles|content|copywriting|manuscript|chapter|chapters)\b/.test(text);
  const media = /\b(video|videos|clip|clips|clipper|reel|reels|short|shorts|tiktok|youtube|podcast|social|media|design|graphic|graphics|art|creative|thumbnail)\b/.test(text);
  const commerce = /\b(checkout|payment|payments|store|shop|commerce|subscription|booking|appointment|scheduling|reservation)\b/.test(text);
  const any = web || publishing || media || commerce;
  return {
    siteLinks: web || !any, // permissive default: a live site link is a plausible product for anyone
    documents: publishing,
    media,
    postLinks: media, // a clipper's output includes the link to the published post
    paymentLinks: commerce,
    bookingLinks: commerce,
  };
}

/** Does this company communicate outward (email / DM / posts) → show a Comms tab? */
function doesOutreach(text: string): boolean {
  return /\b(agency|outreach|email|emails|mail|sales|lead|leads|market|marketing|newsletter|cold|campaign|campaigns|crm|prospect|prospecting|outbound|reply|replies|inbox|dm|dms)\b/.test(text);
}

function primaryLinkIcon(icon: DeliverableIcon, k: ProductKinds): boolean {
  if (icon === "site") return k.siteLinks;
  if (icon === "payment") return k.paymentLinks;
  if (icon === "booking") return k.bookingLinks;
  return false; // status / ops / generic link → work log, not a headline output
}

// ── spec ─────────────────────────────────────────────────────────────────────

function primaryCopy(k: ProductKinds): { label: string; blurb: string; empty: string } {
  if (k.documents) return { label: "Published work", blurb: "The books, chapters, and pieces your company produced", empty: "No published pieces yet — chapters and books appear here as the crew writes them." };
  if (k.media) return { label: "Produced media", blurb: "The clips and assets your company made, and where they went live", empty: "No clips yet — produced media and its post links appear here." };
  return { label: "Deliverables", blurb: "The live sites and pages your company built", empty: "No sites yet — each generated website appears here as the crew ships it." };
}

/**
 * Build the output spec for a company from its profile signal. Pass a `blurb`
 * enriched with recent activity + issue titles for the sharpest read of what the
 * crew is actually producing.
 */
export function outputSpecForCompany(profile: CompanyProfile): OutputSpec {
  const identity = identityText(profile);
  const k = kindsFor(identity); // product kind from identity ONLY — task titles are too noisy
  const copy = primaryCopy(k);
  // Outreach is a behavior, so what the crew DOES (activity/task titles) counts here.
  const comms = doesOutreach(`${identity} ${profile.activityText ?? ""}`.toLowerCase());
  return {
    primaryLabel: copy.label,
    primaryBlurb: copy.blurb,
    emptyHint: copy.empty,
    comms,
    commsLabel: "Emails",
    commsBlurb: "Outreach the crew sent and the replies that came back",
    classOf(c: ClassifiedDeliverable): OutputClass {
      if (c.category === "internal") return "worklog";
      if (c.category === "link") {
        if (c.reviewable) return "primary"; // a per-lead customer preview is always a headline output
        if (primaryLinkIcon(c.icon, k)) return "primary";
        // For a media/clipper company, a plain external link is where a clip went
        // live (a post) — its headline output. (Ops/status links stay work log.)
        if (k.postLinks && c.icon !== "status") return "primary";
        return "worklog";
      }
      if (c.category === "media") return k.media ? "primary" : "worklog";
      if (c.category === "report") return k.documents && !isWorkNote(c) ? "primary" : "worklog";
      return "worklog"; // data (csv / json / …) is evidence of work, never the product itself
    },
  };
}
