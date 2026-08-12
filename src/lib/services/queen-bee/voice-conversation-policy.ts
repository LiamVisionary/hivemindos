/** Keep expensive context and tool schemas off turns that cannot use them. */
export function voiceTurnHiveContextKinds(transcript: string) {
  const message = transcript.trim();
  if (!message) return { memories: false, board: false, business: false };
  const broadBrief =
    /\b(?:daily briefing|brief me|what(?:'s| is) new|latest|today's? (?:brief|priorities|status)|hive pulse)\b/i.test(message);
  return {
    memories:
      broadBrief
      || /\b(?:hive(?:mind)?|brain|memory|memories|remember|recalled?|preference|notes?|vault)\b/i.test(message),
    board:
      broadBrief
      || /\b(?:work\s*board|to[-\s]?do(?:\s+list)?|tasks?|projects?|priorit(?:y|ies)|goals?|ready|working|needs human|marketplace|inbox|outreach|threads?)\b/i.test(message),
    business:
      broadBrief
      || /\b(?:compan(?:y|ies)|agenc(?:y|ies)|marketplace|inbox|email|outreach|thread|calendar|schedule|ledger|revenue)\b/i.test(message),
  };
}

export function isWalletBalanceReadQuery(transcript: string) {
  const message = transcript.trim();
  if (!message || !/\bwallets?\b/i.test(message)) return false;
  if (/\b(?:send|swap|trade|buy|sell|transfer|pay|withdraw|bridge|claim|fund|top\s*up)\b/i.test(message)) {
    return false;
  }
  return /\b(?:balances?|portfolio|holdings?|funds?|money|how\s+much|what(?:'s|\s+is|\s+are))\b/i.test(message);
}

export function voiceTurnNeedsHiveContext(transcript: string) {
  const kinds = voiceTurnHiveContextKinds(transcript);
  return kinds.memories || kinds.board || kinds.business;
}

export function voiceTurnShouldOfferTools(transcript: string) {
  const message = transcript.trim();
  if (!message) return false;
  if (isWalletBalanceReadQuery(message)) return true;
  if (
    /\b(?:individual|specific|full|actual|each)\s+(?:emails?|messages?|threads?|events?|items?)\b/i.test(message)
  ) {
    return true;
  }
  const action =
    /\b(?:check|look\s*up|search|find|fetch|read|open|show|list|send|create|add|edit|write|save|delete|remove|archive|swap|trade|buy|sell|transfer|pay|schedule|deploy|build|fix|research|investigate|automate|run|execute|call|message|email)\b/i.test(message);
  const liveSubject =
    /\b(?:x|twitter|tweets?|posts?|timeline|news|weather|price|market|wallet|balance|calendar|emails?|messages?|inbox|agent|fleet|runtime|connected\s+apps?|files?|notes?)\b/i.test(message);
  const naturalDataQuestion =
    /\b(?:how\s+(?:much|many)|what(?:'s|\s+is|\s+are|\s+do)|which|who|where|when|do\s+(?:i|we)|is\s+there|are\s+there|tell\s+me|give\s+me)\b/i.test(message);
  const hiveDataSubject =
    /\b(?:hive(?:mind)?(?:os)?|shared\s+brain|brain|memor(?:y|ies)|vault|notes?|work\s*board|to[-\s]?do(?:\s+list)?|tasks?|projects?|compan(?:y|ies)|agenc(?:y|ies)|marketplace|inbox|emails?|calendar|schedule|wallets?|balances?|revenue|agents?|fleet|runtimes?|connected\s+apps?|files?)\b/i.test(message);
  return (action && liveSubject) || (naturalDataQuestion && hiveDataSubject);
}

/** Spoken once when a tool has actually started; never stored as the reply. */
export function voiceToolAcknowledgement(transcript: string) {
  const message = transcript.trim();
  if (isWalletBalanceReadQuery(message)) {
    return "Checking your wallets now.";
  }
  if (/\b(?:open|launch)\b[\s\S]*\bnotes?\b|\bnotes?\b[\s\S]*\b(?:open|launch)\b/i.test(message)) {
    return "Opening Notes now.";
  }
  if (/\b(?:marketplace|inbox|emails?|messages?|threads?)\b/i.test(message)) {
    return "Checking the inbox now.";
  }
  if (/\b(?:search|find|look\s*up|check|read)\b/i.test(message)) {
    return "Let me check that.";
  }
  return "On it. Give me a moment.";
}

/** Live-chat 5.6 models should not hide speech behind a reasoning pause. */
export function voiceReasoningEffort(model: string): "none" | "low" {
  return /^gpt-5\.6-(?:luna|terra|sol)(?:$|[-:])/i.test(model.trim())
    ? "none"
    : "low";
}

export function voiceInferenceUsageFields(
  usage: Record<string, unknown> | undefined,
) {
  const promptDetails = usage?.prompt_tokens_details;
  const completionDetails = usage?.completion_tokens_details;
  return {
    inputTokens: Number(usage?.prompt_tokens) || null,
    cachedPromptTokens:
      promptDetails && typeof promptDetails === "object"
        ? Number((promptDetails as { cached_tokens?: unknown }).cached_tokens) || 0
        : null,
    outputTokens: Number(usage?.completion_tokens) || null,
    reasoningTokens:
      completionDetails && typeof completionDetails === "object"
        ? Number((completionDetails as { reasoning_tokens?: unknown }).reasoning_tokens) || 0
        : null,
  };
}
