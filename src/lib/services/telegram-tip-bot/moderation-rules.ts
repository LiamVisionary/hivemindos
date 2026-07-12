export type ModerationReason =
  | "sales-solicitation"
  | "credential-scam"
  | "blocked-domain"
  | "flood"
  | "duplicate"
  | "new-member-link";

export type ModerationSeverity = "low" | "medium" | "high";

export type ModerationDecision = {
  reason: ModerationReason;
  severity: ModerationSeverity;
  explanation: string;
  routeToSales: boolean;
};

export type ModerationAction = "redirect-delete" | "warn-delete" | "mute-delete" | "ban-delete";

export type ModerationRuleInput = {
  text: string;
  memberMessageCount: number;
  newMemberMessageLimit: number;
  allowedDomains?: readonly string[];
  blockedDomains?: readonly string[];
  duplicate?: boolean;
  flood?: boolean;
};

const SALES_PATTERNS = [
  /waiting for (?:your|a) response regarding.{0,120}\b(article|listing|promotion|partnership|collaboration)\b/i,
  /\b(?:interested|would like|want) (?:in )?(?:covering|featuring|promoting|publishing|listing).{0,100}\b(?:your|the) (?:project|token|company|community)\b/i,
  /\b(?:binance|coinmarketcap|coingecko|coindesk|forbes)\b.{0,120}\b(?:publish(?:ed|ing)? (?:an )?article|media coverage|feature your|list your|paid promotion)\b/i,
  /\b(?:publish(?:ed|ing)? (?:an )?article|media coverage|feature your|list your|paid promotion)\b.{0,120}\b(?:binance|coinmarketcap|coingecko|coindesk|forbes)\b/i,
  /\b(?:marketing|promotion|sponsorship|partnership|business proposal|media package)\b.{0,120}\b(?:project|token|community|founder|team)\b/i,
  /\b(?:we represent|i represent|our agency|our publication)\b.{0,120}\b(?:article|coverage|listing|promotion|partnership)\b/i,
];

const CREDENTIAL_SCAM_PATTERNS = [
  /\b(?:send|share|enter|verify|confirm)\b.{0,80}\b(?:seed phrase|recovery phrase|private key)\b/i,
  /\b(?:seed phrase|recovery phrase|private key)\b.{0,80}\b(?:send|share|enter|verify|confirm)\b/i,
  /\bconnect (?:your )?wallet\b.{0,100}\b(?:claim|airdrop|verify|migration|restore|unlock)\b/i,
  /\b(?:claim|airdrop|migration|restore|unlock)\b.{0,100}\bconnect (?:your )?wallet\b/i,
  /\b(?:support|admin|moderator)\b.{0,80}\b(?:dm|direct message|contact)\b.{0,80}\b(?:wallet|funds|token|account)\b/i,
  /\b(?:guaranteed|double|triple)\b.{0,50}\b(?:returns?|profit|tokens?|crypto)\b/i,
];

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+|\b(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+(?:\/[^\s<>()]*)?/gi;

export function normalizeModerationText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(URL_PATTERN, " <url> ")
    .replace(/@[a-z0-9_]{3,}/gi, " <mention> ")
    .replace(/[^a-z0-9<>$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractModerationDomains(text: string): string[] {
  const domains = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const token = match[0].replace(/[.,!?;:]+$/, "");
    try {
      const value = /^https?:\/\//i.test(token) ? token : `https://${token}`;
      const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
      if (hostname) domains.add(hostname);
    } catch {
      // A malformed URL-like token is not enough to moderate by itself.
    }
  }
  return [...domains];
}

function domainMatches(domain: string, configuredDomain: string): boolean {
  const normalized = configuredDomain.trim().toLowerCase().replace(/^www\./, "");
  return Boolean(normalized && (domain === normalized || domain.endsWith(`.${normalized}`)));
}

function hasConfiguredDomain(domains: readonly string[], configuredDomains: readonly string[]): boolean {
  return domains.some((domain) => configuredDomains.some((configured) => domainMatches(domain, configured)));
}

export function classifyModerationMessage(input: ModerationRuleInput): ModerationDecision | null {
  const text = input.text.trim();
  if (!text) return null;

  if (CREDENTIAL_SCAM_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      reason: "credential-scam",
      severity: "high",
      explanation: "credential or wallet-drain language",
      routeToSales: false,
    };
  }

  if (SALES_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      reason: "sales-solicitation",
      severity: "low",
      explanation: "unsolicited project coverage, listing, or promotional outreach",
      routeToSales: true,
    };
  }

  const domains = extractModerationDomains(text);
  if (hasConfiguredDomain(domains, input.blockedDomains ?? [])) {
    return {
      reason: "blocked-domain",
      severity: "high",
      explanation: "blocked domain",
      routeToSales: false,
    };
  }

  if (input.flood) {
    return { reason: "flood", severity: "medium", explanation: "message flood", routeToSales: false };
  }

  if (input.duplicate) {
    return { reason: "duplicate", severity: "medium", explanation: "repeated message", routeToSales: false };
  }

  const hasUnapprovedLink =
    domains.length > 0 && !domains.every((domain) => hasConfiguredDomain([domain], input.allowedDomains ?? []));
  if (input.memberMessageCount <= input.newMemberMessageLimit && hasUnapprovedLink) {
    return {
      reason: "new-member-link",
      severity: "medium",
      explanation: "external link from a new member",
      routeToSales: false,
    };
  }

  return null;
}

export function moderationActionFor(decision: ModerationDecision, priorStrikes: number, banAfterStrikes: number): ModerationAction {
  if (decision.routeToSales) return "redirect-delete";
  if (decision.severity === "high") return "ban-delete";
  const nextStrike = priorStrikes + 1;
  if (nextStrike >= banAfterStrikes) return "ban-delete";
  if (nextStrike >= 2 || decision.reason === "flood") return "mute-delete";
  return "warn-delete";
}

export type ParsedModerationCommand = {
  command: "warn" | "mute" | "ban" | "unban" | "trust" | "untrust" | "modstats" | "modmode" | "modhelp";
  args: string;
};

export function parseModerationCommand(text: string, botUsername: string): ParsedModerationCommand | null {
  const match = text.trim().match(/^\/(warn|mute|ban|unban|trust|untrust|modstats|modmode|modhelp)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== botUsername.toLowerCase()) return null;
  return {
    command: match[1].toLowerCase() as ParsedModerationCommand["command"],
    args: (match[3] ?? "").trim(),
  };
}
