import { hiveEnvPresence } from "@/lib/services/shared-hive-env";
import { readMapsAgencyOutboxSendBlockerKeys } from "@/lib/services/company-outreach-outbox";

// A company's autonomous crew pauses work when a required shared-env key is
// absent (e.g. no CAN-SPAM mailing address, no payment key). Those blockers are
// buried in the outreach engine's send-blocker strings; the generic "delegation
// exhausted" needs-human card never names them. This turns them into a concrete,
// high-priority setup issue the operator can clear with a single paste-and-save.
//
// The issue is DERIVED from env presence: a key only appears while it's actually
// absent from the shared hive env, so saving it (or setting it anywhere else)
// makes the issue disappear on the next fetch — no task mutation required.

export type CompanySetupBlockerKind = "secret" | "text";

export type CompanySetupBlockerLink = { label: string; url: string };

export type CompanySetupBlocker = {
  /** Shared-env key that's missing (e.g. OUTREACH_PHYSICAL_ADDRESS). */
  envKey: string;
  /** Short, human title for the issue card. */
  title: string;
  /** Why the crew is blocked and what to paste. */
  explanation: string;
  /** "secret" masks the input; "text" (e.g. a mailing address) shows it plainly. */
  kind: CompanySetupBlockerKind;
  /** Input placeholder. */
  placeholder: string;
  /** Optional help links (where to get the value). */
  links: CompanySetupBlockerLink[];
};

// Friendly copy for keys we know about; anything else detected gets generic copy.
const SETUP_KEY_REGISTRY: Record<string, Omit<CompanySetupBlocker, "envKey">> = {
  OUTREACH_PHYSICAL_ADDRESS: {
    title: "Add a mailing address for outreach emails",
    explanation:
      "US anti-spam law (CAN-SPAM) requires a physical postal address in the footer of every cold email, so your crew has paused most sends until this is set. A PO box or mailbox service is fine — it does not have to be your home address.",
    kind: "text",
    placeholder: "123 Main St, Suite 200, Sarasota, FL 34236",
    links: [
      { label: "About CAN-SPAM addresses", url: "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business" },
    ],
  },
  AGENTMAIL_API_KEY: {
    title: "Connect AgentMail so the crew can send email",
    explanation: "Your crew sends outreach through AgentMail. Paste your AgentMail API key so agents can send and read mail on this company's behalf.",
    kind: "secret",
    placeholder: "Paste the AgentMail API key",
    links: [{ label: "AgentMail", url: "https://agentmail.to" }],
  },
  STRIPE_SECRET_KEY: {
    title: "Connect Stripe to take payments",
    explanation: "Without a payment rail the crew can book calls but can't charge clients. Paste your Stripe secret key to turn on checkout.",
    kind: "secret",
    placeholder: "sk_live_…",
    links: [{ label: "Stripe API keys", url: "https://dashboard.stripe.com/apikeys" }],
  },
};

function genericBlocker(envKey: string): Omit<CompanySetupBlocker, "envKey"> {
  const looksSecret = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/.test(envKey);
  return {
    title: `Set ${envKey}`,
    explanation: `Your crew paused work because the required setting ${envKey} isn't configured in the shared hive env. Add it here to unblock them.`,
    kind: looksSecret ? "secret" : "text",
    placeholder: looksSecret ? `Paste the ${envKey} value` : `Value for ${envKey}`,
    links: [],
  };
}

/**
 * Required shared-env keys blocking this company that are STILL missing. Derived
 * from the outreach engine's own "<KEY> is not configured/set" blocker messages,
 * then filtered to keys absent from the shared hive env — so a key that's since
 * been set self-resolves and never appears. Returns [] when nothing is blocked or
 * the engine isn't on this machine.
 */
export async function readCompanySetupBlockers(company: { id: string; projectId?: string }): Promise<CompanySetupBlocker[]> {
  const namedKeys = await readMapsAgencyOutboxSendBlockerKeys({ companyId: company.id, projectId: company.projectId });
  if (namedKeys.length === 0) return [];
  const presence = await hiveEnvPresence(namedKeys);
  const absent = presence.filter((entry) => !entry.present).map((entry) => entry.key);
  return absent.map((envKey) => ({ envKey, ...(SETUP_KEY_REGISTRY[envKey] ?? genericBlocker(envKey)) }));
}
