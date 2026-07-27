/* company-ceo-tools.ts — client execution for the Company-CEO chat tools.
   When the shared Queen chat is scoped to a company (companyCeoScope), the
   server offers the model three extra tools; like the other client tools they
   are EXECUTED here and their results fed back into the tool loop:

   - company_add_directive  → POST /api/companies action "add-directive"
   - company_update_charter → POST /api/companies action "upsert" (id+name+charter
     only — upsertCompany preserves every field it doesn't receive, but `name`
     is REQUIRED, so we send the company's live name to avoid clobbering a rename)
   - company_dispatch_goal  → POST /api/companies action "dispatch-goal"

   Dispatch is mechanically gated the same way create_hive_task is (see
   userAuthorizedHiveTaskCreation in queen-brain.ts): unless the user's current
   message plausibly asks to launch/dispatch, the call is turned into a proposal
   the Queen must put to the user in prose. */

export type CompanyCeoScope = {
  companyId: string;
  companyName: string;
};

/** Tool names the company-scoped Queen may call; executed client-side here. */
export const COMPANY_CEO_TOOL_NAMES = new Set([
  "company_add_directive",
  "company_update_charter",
  "company_dispatch_goal",
]);

/** Live tool-phase labels for the per-turn bee loader (same contract as the
 *  toolStatus map in queen-chat-store — short, present-tense, ellipsis). */
export const COMPANY_CEO_TOOL_STATUS: Record<string, string> = {
  company_add_directive: "Recording directive…",
  company_update_charter: "Updating charter…",
  company_dispatch_goal: "Launching the crew…",
};

/** A near-whole-message affirmative — the user agreeing to the launch the Queen
 *  just proposed ("yes", "launch it", "go ahead"). Mirrors TASK_AFFIRMATIVE_RE. */
const DISPATCH_AFFIRMATIVE_RE =
  /^(yes|yeah|yep|sure|ok(ay)?|do it|go ahead|go for it|please do|sounds good|confirm(ed)?|launch( it)?|dispatch( it)?|ship it|start( it)?|kick it off|send it|go)\b[\s,!.]*(please|thanks|thank you)?[\s!.]*$/i;

/** Launch-intent verbs that make a dispatch plausible anywhere in the message
 *  ("launch the crew", "dispatch the goal", "get the company working"). */
const DISPATCH_INTENT_RE =
  /\b(launch|dispatch|deploy|kick ?off|start (the |work|it)|begin work|go live|set .{0,30}in motion|put .{0,30}to work|get .{0,40}(working|running|moving|started)|run the (crew|company|goal))\b/i;

/**
 * Mechanical propose-then-confirm for company_dispatch_goal — dispatch enters
 * perpetual autonomy and spends real budget, so the model may only execute it
 * when the user's CURRENT message asks for a launch or affirms the Queen's
 * pending offer. Fails safe: a false negative costs one extra "yes".
 */
export function userAuthorizedCompanyDispatch(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;
  return DISPATCH_AFFIRMATIVE_RE.test(trimmed) || DISPATCH_INTENT_RE.test(trimmed);
}

/** Synthetic tool result handed to the model when dispatch was not authorized. */
export const COMPANY_DISPATCH_NOT_AUTHORIZED_RESULT =
  "NOT dispatched — the user has not asked to launch the crew. Tell them what dispatching would do and ASK whether to launch; dispatch only after they explicitly say yes.";

type CompaniesPostResult = { ok?: boolean; error?: string } & Record<string, unknown>;

async function postCompanies(payload: Record<string, unknown>): Promise<CompaniesPostResult | null> {
  const res = await fetch("/api/companies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json().catch(() => null)) as CompaniesPostResult | null;
}

/** The company's CURRENT stored name — required by the upsert action (an empty
 *  name is rejected server-side, and a stale one would clobber a rename). */
async function fetchLiveCompanyName(companyId: string): Promise<string | null> {
  const res = await fetch("/api/companies", { cache: "no-store" }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as {
    ok?: boolean;
    companies?: Array<{ company?: { id?: string; name?: string } }>;
  } | null;
  if (!data?.ok || !Array.isArray(data.companies)) return null;
  const entry = data.companies.find((item) => item.company?.id === companyId);
  return entry?.company?.name?.trim() || null;
}

/**
 * Execute one company-CEO tool call and return the string result for the tool
 * loop. Never throws — errors come back as honest prose the Queen can relay.
 */
export async function executeCompanyCeoTool(
  name: string,
  args: Record<string, unknown>,
  scope: CompanyCeoScope | null,
): Promise<string> {
  if (!scope) {
    return "No company is in scope for this chat — ask the user to open a company's Talk to CEO first.";
  }
  try {
    if (name === "company_add_directive") {
      const text = String(args.text ?? "").trim();
      if (!text) return "The directive needs text — nothing was recorded.";
      const skills = Array.isArray(args.skills)
        ? args.skills.map((skill) => String(skill)).filter(Boolean)
        : undefined;
      const data = await postCompanies({
        action: "add-directive",
        id: scope.companyId,
        directive: { text, skills, source: "inject" },
      });
      if (!data?.ok) return `The directive was not recorded: ${data?.error || "the companies API did not respond."}`;
      return `Directive recorded for ${scope.companyName}. It reaches the crew's dispatch context on the next work cycle.`;
    }
    if (name === "company_update_charter") {
      const charter = String(args.charter ?? "").trim();
      if (!charter) return "The charter update was empty — nothing was changed.";
      // upsert requires the company name; everything else it doesn't receive is
      // preserved server-side (verified against upsertCompany's merge).
      const liveName = await fetchLiveCompanyName(scope.companyId);
      const data = await postCompanies({
        action: "upsert",
        id: scope.companyId,
        name: liveName || scope.companyName,
        charter,
      });
      if (!data?.ok) return `The charter was not updated: ${data?.error || "the companies API did not respond."}`;
      return `Charter updated for ${scope.companyName}.`;
    }
    if (name === "company_dispatch_goal") {
      const data = await postCompanies({ action: "dispatch-goal", id: scope.companyId });
      if (!data?.ok) return `The crew was not launched: ${data?.error || "the companies API did not respond."}`;
      return `Launched — ${scope.companyName} is in perpetual autonomy and the crew is being dispatched toward the apex goal.`;
    }
    return "Unknown company tool.";
  } catch {
    return "That company action didn't complete.";
  }
}
