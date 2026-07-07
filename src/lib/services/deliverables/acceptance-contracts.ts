// Deliverable Acceptance Contracts — the platform-wide, per-deliverable-KIND
// definition of "is this outward deliverable actually good, or is it a
// placeholder/wireframe skeleton?"
//
// WHY THIS EXISTS
// A Zero Human Company can ship a real, complete template but starve it of data
// so it renders as a skeleton (real bug, 2026-07-07: a restaurant preview shipped
// to a live prospect with 3 fake "menu" items like "Menu / offer clarity" — no
// prices, no dish photos, an empty menu category, a single generic stock hero).
// The template was correct; the DATA was wireframe. The platform had a live-URL
// integrity gate (is the link alive?) but no CONTENT acceptance gate (is the
// deliverable actually good?). This module is that missing contract, lifted out
// of any one company/repo so EVERY company inherits the same standard.
//
// DESIGN
//  - PURE + client-safe. No `fetch`/`fs` — fetched content is passed in. Safe to
//    import from `loop-runner.ts` (which is bundled client-side).
//  - A CAPABILITY MATRIX keyed by deliverable kind (restaurant preview, generic
//    web page, outreach email). Add a contract row, don't scatter conditionals.
//  - FAIL CLOSED on AFFIRMATIVE failure only. A contract returns `fail` only when
//    it positively detects placeholder/broken content; when it cannot tell (wrong
//    kind, unfetchable, ambiguous) it returns `unknown` and never blocks. This
//    mirrors the live-URL gate's "only a definitive 404/NXDOMAIN blocks" rule so
//    the gate never cries wolf on a legitimate minimal page.
import { isReservedOrMockUrl } from "@/lib/net/reserved-urls";

export type AcceptanceStatus = "pass" | "fail" | "unknown";

/** A deliverable to judge. `url`/`path` locate it; `kindLabel` is an optional hint
 *  from deliverables-model.ts (e.g. "Preview site"). Content is fetched separately. */
export interface DeliverableArtifact {
  url?: string;
  path?: string;
  kindLabel?: string;
}

/** Fetched bytes for an artifact — injected by the server; faked in tests. */
export interface FetchedContent {
  body: string;
  contentType?: string;
  status?: number;
}

export interface AcceptanceViolation {
  /** Stable machine code, e.g. "menu-items-unpriced". */
  code: string;
  message: string;
  evidence?: string;
}

export interface AcceptanceVerdict {
  contractId: string;
  contractLabel: string;
  status: AcceptanceStatus;
  violations: AcceptanceViolation[];
  /** Positive signals detected (used to explain a pass). */
  signals: string[];
}

export interface DeliverableAcceptanceContract {
  id: string;
  label: string;
  /** Cheap URL/kind gate: is this artifact even a candidate for this contract? */
  appliesTo(artifact: DeliverableArtifact): boolean;
  /** Judge fetched content. MUST be pure. `unknown` = abstain (never blocks). */
  evaluate(content: FetchedContent, artifact: DeliverableArtifact): AcceptanceVerdict;
}

// ── shared helpers ───────────────────────────────────────────────────────────

function verdict(
  contract: { id: string; label: string },
  status: AcceptanceStatus,
  violations: AcceptanceViolation[] = [],
  signals: string[] = [],
): AcceptanceVerdict {
  return { contractId: contract.id, contractLabel: contract.label, status, violations, signals };
}

/** Strip HTML tags/entities to visible text, for "near-empty page" checks. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeHtml(content: FetchedContent): boolean {
  if (/html/i.test(content.contentType ?? "")) return true;
  return /<(?:!doctype|html|section|div|body)\b/i.test(content.body.slice(0, 2000));
}

function tryParseJson(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

// A menu-item name that describes a WEBSITE FEATURE (wireframe copy) instead of a
// dish. This is the exact fingerprint of the 2026-07-07 failure ("Menu / offer
// clarity", "Hours + location path", "Booking / order CTA") generalized: feature
// vocabulary, calls-to-action, and layout jargon that never name real food.
// Deliberately made of multi-word feature phrases, not bare words: a single real
// dish/drink named "Clarity" or "Conversion" must not trip this. (Bare "clarity",
// "conversion", "layout" were removed for exactly that reason.)
const WIREFRAME_ITEM_NAME =
  /\b(?:offer clarity|call[-\s]?to[-\s]?action|\bcta\b|above the fold|conversion path|mobile[-\s]?first|location path|order cta|booking\s*\/|hours\s*[+\/]|next step|placeholder|lorem ipsum|wireframe|your (?:menu|offer|text|logo)|tbd|coming soon|insert (?:menu|item|text)|sample (?:item|dish))\b/i;

function isWireframeItemName(name: string): boolean {
  const n = String(name || "").trim();
  if (!n) return false;
  if (WIREFRAME_ITEM_NAME.test(n)) return true;
  // "X / Y path"-style feature phrasing (slashed non-food descriptors).
  if (/\s\/\s/.test(n) && /\b(path|clarity|cta|offer|info|access)\b/i.test(n)) return true;
  return false;
}

function priceLooksReal(price: string): boolean {
  return /\d/.test(String(price || ""));
}

// ── restaurant-website-preview contract ──────────────────────────────────────
// Governs the `restaurant-experience` preview template (served at `/preview/<slug>`
// or `preview.<host>/p/<slug>`). Judges the actual menu the way a diner would: a
// real restaurant menu has multiple priced dishes and no empty categories.

// Structural signature of the restaurant-experience template. Shared so the generic
// web-page contract can DEFER on restaurant pages (its near-empty check must not
// override a menu the restaurant contract already judged).
function isRestaurantHtml(html: string): boolean {
  return (
    /class="dish/i.test(html) ||
    /class="cat"/i.test(html) ||
    /id="menu"/i.test(html) ||
    /Featured plates/i.test(html) ||
    (/variant-[a-z-]+/i.test(html) && /\b(menu|reserv|dish)\b/i.test(html))
  );
}

interface ParsedDish {
  name: string;
  price: string;
  hasImage: boolean;
}

function parseHtmlDishes(html: string): { dishes: ParsedDish[]; categoryCount: number; emptyCategory: boolean } {
  // The template renders each dish as
  //   <div class="dish[ with-img]"><img?><b>NAME</b><strong>$PRICE</strong><p>DESC</p></div>
  // and groups them under <div class="cat"><h3>TITLE</h3> … </div>. Dish divs have
  // no nested <div>, so a non-greedy capture to the first </div> is safe.
  const dishRe = /<div class="dish[^"]*">([\s\S]*?)<\/div>/gi;
  const parseDish = (inner: string): ParsedDish => ({
    name: (inner.match(/<b>([\s\S]*?)<\/b>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim(),
    price: (inner.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim(),
    hasImage: /<img\b/i.test(inner),
  });
  const dishes = [...html.matchAll(dishRe)].map((m) => parseDish(m[1])).filter((d) => d.name);

  // Per-category dish presence: split on category boundaries and count dishes in each.
  const segments = html.split(/<div class="cat">/i).slice(1);
  const categoryCount = segments.length;
  const emptyCategory = segments.some((seg) => {
    const untilNext = seg.split(/<div class="cat">/i)[0];
    const hasHeading = /<h3\b/i.test(untilNext);
    const hasDish = /<div class="dish/i.test(untilNext);
    return hasHeading && !hasDish;
  });
  return { dishes, categoryCount, emptyCategory };
}

function parseJsonMenu(config: Record<string, unknown>): {
  entries: { name: string; price: string; hasImage: boolean }[];
  heroImages: number;
} | null {
  const profile = (config.business_profile ?? config) as Record<string, unknown>;
  const rawEntries = profile.menu_entries;
  if (!Array.isArray(rawEntries)) return null;
  const entries = rawEntries
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      name: String(e.name ?? "").trim(),
      price: String(e.price ?? "").trim(),
      hasImage: Boolean(String(e.image_url ?? "").trim()),
    }))
    .filter((e) => e.name);
  const imageUrls = Array.isArray(profile.image_urls) ? profile.image_urls.filter((u) => String(u || "").trim()).length : 0;
  const generated = Array.isArray(profile.generated_image_urls) ? profile.generated_image_urls.length : 0;
  const placePhotos = Array.isArray(profile.google_place_photos) ? profile.google_place_photos.length : 0;
  return { entries, heroImages: imageUrls + generated + placePhotos };
}

/** Shared menu judgment used by both the HTML and JSON paths. */
function judgeMenu(
  contract: { id: string; label: string },
  items: { name: string; price: string; hasImage: boolean }[],
  opts: { emptyCategory?: boolean; heroImages?: number },
): AcceptanceVerdict {
  const violations: AcceptanceViolation[] = [];
  const signals: string[] = [];
  const dishCount = items.length;
  const priced = items.filter((d) => priceLooksReal(d.price));
  const withImage = items.filter((d) => d.hasImage);
  const wireframe = items.filter((d) => isWireframeItemName(d.name));

  if (dishCount >= 1 && priced.length === 0) {
    violations.push({
      code: "menu-items-unpriced",
      message: `All ${dishCount} menu item(s) render with no price — a real restaurant menu shows prices.`,
      evidence: items.slice(0, 3).map((d) => d.name).join(" · "),
    });
  }
  // Fire only when wireframe/feature labels are a MAJORITY of the items — a single
  // oddly-named real dish must never fail an otherwise-healthy, priced menu.
  if (wireframe.length && wireframe.length * 2 >= dishCount) {
    violations.push({
      code: "menu-placeholder-labels",
      message: `${wireframe.length} of ${dishCount} "menu" item(s) are website-feature labels, not real dishes.`,
      evidence: wireframe.slice(0, 3).map((d) => d.name).join(" · "),
    });
  }
  // NB: no standalone "too few items" rule — a legit small/tasting menu is real, and
  // the unpriced + placeholder-label + empty-category checks already catch the
  // degraded skeletons without blocking a genuinely short priced menu.
  if (opts.emptyCategory) {
    violations.push({ code: "empty-menu-category", message: "A menu category heading renders with no dishes under it." });
  }
  // NB: no "missing imagery" hard-fail — a plain, image-light but real priced menu is a
  // valid (if basic) deliverable, not a placeholder. Imagery is reported as a signal only.

  if (priced.length) signals.push(`${priced.length} priced menu item(s)`);
  if (withImage.length) signals.push(`${withImage.length} dish image(s)`);
  if (opts.heroImages) signals.push(`${opts.heroImages} hero image(s)`);

  return verdict(contract, violations.length ? "fail" : "pass", violations, signals);
}

const RESTAURANT_PREVIEW: DeliverableAcceptanceContract = {
  id: "restaurant-website-preview",
  label: "Restaurant website preview",
  appliesTo(artifact) {
    const url = artifact.url ?? "";
    if (!/^https?:\/\//i.test(url) || isReservedOrMockUrl(url)) return false;
    const u = url.toLowerCase();
    let host = "";
    try { host = new URL(u).hostname; } catch { /* path rules only */ }
    const slug = u.match(/\/(?:preview|p)\/([^/?#]+)/)?.[1] ?? "";
    const isQaSlug = !slug || /^(?:qa|test)[-_]/.test(slug) || slug.includes("__");
    const previewShaped = (/\/(?:preview|p)\//.test(u) && !isQaSlug) || host.startsWith("preview.");
    // Also accept an explicit kind hint from the classifier.
    return previewShaped || /preview site/i.test(artifact.kindLabel ?? "");
  },
  evaluate(content) {
    // JSON config path (the R2 `/previews/<token>.json`, if that is what was fetched).
    const json = tryParseJson(content.body);
    if (json && typeof json === "object") {
      const menu = parseJsonMenu(json as Record<string, unknown>);
      if (menu) return judgeMenu(this, menu.entries, { heroImages: menu.heroImages });
    }
    if (!looksLikeHtml(content)) return verdict(this, "unknown");
    const html = content.body;
    // Confirm this is actually a restaurant-experience page before judging its menu.
    if (!isRestaurantHtml(html)) return verdict(this, "unknown");
    const { dishes, emptyCategory } = parseHtmlDishes(html);
    const heroImages = /class="[^"]*photo-card[^"]*"[\s\S]{0,400}?<img\b/i.test(html) ? 1 : 0;
    return judgeMenu(this, dishes, { emptyCategory, heroImages });
  },
};

// ── generic web-page contract ────────────────────────────────────────────────
// Any other web deliverable presented to a customer. Conservative: only fires on
// unambiguous placeholder tells so it never blocks a legitimately-minimal page.

const WEB_PAGE: DeliverableAcceptanceContract = {
  id: "web-page",
  label: "Web page / landing preview",
  appliesTo(artifact) {
    const url = artifact.url ?? "";
    return /^https?:\/\//i.test(url) && !isReservedOrMockUrl(url);
  },
  evaluate(content) {
    if (!looksLikeHtml(content)) return verdict(this, "unknown");
    const html = content.body;
    // Defer to the restaurant contract on its own pages — a text-light but real menu
    // must not be failed by this generic near-empty check.
    if (isRestaurantHtml(html)) return verdict(this, "unknown");
    const violations: AcceptanceViolation[] = [];
    if (/lorem ipsum/i.test(html)) {
      violations.push({ code: "lorem-ipsum", message: "Page contains lorem-ipsum filler text." });
    }
    // Case-insensitive for the phrase tells; the ALL-CAPS bracket ([FIRST NAME]) stays
    // case-sensitive so ordinary bracketed prose ("[see menu]") is not a false hit.
    const placeholderTell =
      html.match(/your (?:headline|text|content|logo) here|insert (?:text|content) here|\{\{[^}]+\}\}/i) ||
      html.match(/\[[A-Z_ ]{3,}\]/);
    if (placeholderTell) {
      violations.push({ code: "unfilled-placeholder", message: "Page has unfilled placeholder/template markers.", evidence: placeholderTell[0].slice(0, 60) });
    }
    // Near-empty ONLY when there is also no media/form — an image or form-driven splash
    // with little prose is a legitimate minimal page, not a blank skeleton.
    const text = visibleText(html);
    const hasMedia = /<img\b|<form\b|<input\b|<video\b|<iframe\b|<button\b/i.test(html);
    if (text.length < 120 && !hasMedia) {
      violations.push({ code: "near-empty-page", message: `Page has almost no visible content (${text.length} chars) and no media/form.` });
    }
    if (violations.length) return verdict(this, "fail", violations);
    return verdict(this, "pass", [], [`${text.length} chars of visible content`]);
  },
};

// ── outreach-email contract ──────────────────────────────────────────────────
// Judges the email BODY itself (dead links are already covered by company-email-qa).

const OUTREACH_EMAIL: DeliverableAcceptanceContract = {
  id: "outreach-email",
  label: "Outreach email",
  appliesTo(artifact) {
    return /email/i.test(artifact.kindLabel ?? "") || !!artifact.path?.toLowerCase().endsWith(".eml");
  },
  evaluate(content) {
    const body = content.body;
    const violations: AcceptanceViolation[] = [];
    const unfilled = body.match(/\{\{[^}]+\}\}|\{[A-Za-z_]+\}|\[(?:FIRST_?NAME|NAME|BUSINESS|CITY|COMPANY)\]|%[A-Z_]+%|<<[^>]+>>/);
    if (unfilled) {
      violations.push({ code: "unfilled-merge-field", message: "Email contains an unfilled merge field / template token.", evidence: unfilled[0].slice(0, 40) });
    }
    if (/lorem ipsum/i.test(body)) violations.push({ code: "lorem-ipsum", message: "Email contains lorem-ipsum filler." });
    if (violations.length) return verdict(this, "fail", violations);
    return verdict(this, "unknown"); // a clean body is not, by itself, a positive pass signal here.
  },
};

/** The registry. Ordered most-specific → most-generic. */
export const DELIVERABLE_ACCEPTANCE_CONTRACTS: DeliverableAcceptanceContract[] = [
  RESTAURANT_PREVIEW,
  OUTREACH_EMAIL,
  WEB_PAGE,
];

/** Contracts whose cheap URL/kind gate matches this artifact. */
export function contractsForArtifact(artifact: DeliverableArtifact): DeliverableAcceptanceContract[] {
  return DELIVERABLE_ACCEPTANCE_CONTRACTS.filter((c) => {
    try {
      return c.appliesTo(artifact);
    } catch {
      return false;
    }
  });
}

/**
 * Evaluate all matching contracts against fetched content and merge to the
 * STRONGEST verdict: any `fail` wins (fail-closed on affirmative failure), else a
 * `pass`, else `unknown`. Violations are unioned across failing contracts.
 */
export function evaluateArtifactAcceptance(artifact: DeliverableArtifact, content: FetchedContent): AcceptanceVerdict {
  const matched = contractsForArtifact(artifact);
  const verdicts = matched.map((c) => {
    try {
      return c.evaluate(content, artifact);
    } catch {
      return verdict(c, "unknown");
    }
  });
  const failed = verdicts.filter((v) => v.status === "fail");
  if (failed.length) {
    return {
      contractId: failed.map((v) => v.contractId).join("+"),
      contractLabel: failed[0].contractLabel,
      status: "fail",
      violations: failed.flatMap((v) => v.violations),
      signals: [],
    };
  }
  const passed = verdicts.find((v) => v.status === "pass");
  if (passed) return passed;
  return verdict({ id: matched[0]?.id ?? "none", label: matched[0]?.label ?? "" }, "unknown");
}
