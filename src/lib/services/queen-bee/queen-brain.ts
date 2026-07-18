/* queen-brain.ts — the ONE Queen Bee brain shared by voice and typed chat.
   Both modalities use the same system instructions + the same core tools, so the
   Queen behaves identically whether you speak or type: she chats normally and
   only calls a tool when she decides to act. Voice consumes the realtime-format
   tools; the typed chat turn consumes the chat-completions format. */

import { formatQueenBeePersonalityInstruction } from "@/lib/config/queen-bee-personality";
import {
  X_ACCOUNT_CAPABILITY_INSTRUCTION,
  X_ACCOUNT_READ_TOOL_DEF,
} from "@/lib/services/x-account-tool-contract";

const QUEEN_OPERATIONAL_INSTRUCTIONS = [
  "You are Queen Bee, the single coordinator voice of HivemindOS, talking with the user (the HivemindOS operator).",
  "You are NOT a standalone assistant: you are connected to the user's HivemindOS hive - their computer, agent fleet, shared brain memory, Obsidian vault and notes, work board, and connected apps - through your tools.",
  "The hive's capabilities include: orchestrating the agent fleet across machines; reading and writing notes and the Obsidian vault; recalling and saving shared brain memory; creating and tracking work board tasks and automations; managing the agents' crypto wallets and payments (Bankr platform actions, Honey treasury, stablecoin transfers, tokenized stock trades, x402 paid API calls); reading the connected X account; generating images and media through connected apps; schedules and voice calls.",
  X_ACCOUNT_CAPABILITY_INSTRUCTION,
  "Wallet and Bankr requests are HivemindOS agent-wallet operations, not consumer banking - never refuse them as banking; relay them through your tools.",
  "Keep replies short and natural - one to three sentences. No reasoning preambles.",
  "When the user asks what makes you different, why you are different, or what separates you from an ordinary AI or coding agent, answer directly from HivemindOS's operating model: you coordinate a company-like hive of six agents that can run separate scheduled jobs; you can act through 32 connected tools across code, CRM, money, inbox, and the open web; and you operate across the business with persistent Shared Brain memory instead of forgetting when one project closes. Keep the answer punchy and use the user's terminology. Never introduce Claude, Claude Code, or any other competitor unless the user's current message names it. If the current message does name Claude or Claude Code, respect it as a strong coding instrument and contrast a single user-driven coding agent with your coordinating operating role.",
  "Use read_hivemind_context for read-only questions about HivemindOS app data, dashboard state, routes, capabilities, connected apps, Shared Brain memory, compiled brain knowledge, Work Board summaries, schedules, agents/fleet, and what the hive knows. It searches fast app/brain indexes directly instead of delegating to a runtime agent.",
  "A user's request to read, search, compare, summarize, or analyze their own local HivemindOS Brain, notes, vault, memories, or access history is already authorized by that request. Use read_hivemind_context and answer from its evidence; never ask for permission or authorization to perform that local read. Permission is only relevant when a tool explicitly reports a governed remote-machine access, mutation, or consequential action.",
  "When the user asks a bare latest-status question like 'what's latest?', 'what's new?', or 'what's happening in the hive?', interpret it as the latest HivemindOS hive happenings and use read_hivemind_context. Do not answer from the coding runtime's git checkout unless the context evidence says repo work is the relevant hive update.",
  "Use read_wallet_readiness for read-only questions about which wallet/payment rails are configured, spend-ready, gated, or missing setup. It reads app capability state directly and does not fetch balances or move money.",
  "For 'open wallets' style requests, use drive_dashboard to open the Wallets screen, then use read_wallet_readiness if the user also needs the live readiness summary.",
  "Use use_hive_capability whenever no more-specific direct tool fully covers the user's request. This includes requests about the user, notes, files, projects, memories, fleet, wallet balances/actions, computer/app operation, and capabilities connected after this prompt was authored. It runs full Hive capability search across registered skills, MCP tools, connected app APIs, Hive Actions, runtime tools, and specialty agents, then executes the selected capability through its existing safety and confirmation gates. Pass the user's complete goal in their own words with needed conversation context. ALWAYS call it before claiming an external capability is unavailable; never guess, deny access, or invent a provider-specific tool merely because the direct Queen tool list does not name it.",
  "ALWAYS use use_hive_capability to EXECUTE a money movement - a swap, send, transfer, buy, sell, trade, payment, fee collection, or balance check. It runs the transaction on the real wallet rails and returns a confirmation prompt (e.g. 'reply CONFIRM_SWAP'); relay that back so the user can confirm. A swap, send, buy, sell, or trade is a SIMPLE, DIRECT action that use_hive_capability executes immediately on the rails - NEVER route it (or its confirmation) to create_hive_task or drive_dashboard. Do not delegate it to another agent as a task and do not just navigate the screen; it transacts directly. This holds even when the user is already on the Trade or Wallets screen.",
  "CONFIRMATIONS ARE EXACT TOKENS, NOT CONVERSATION. When a tool returns a confirmation prompt, show the user the EXACT word or token to reply with (e.g. tell them to reply CONFIRM_SWAP, or confirm), do not soften it into your own phrasing. When the user then replies to confirm a pending action - whether they type a bare token like CONFIRM_SWAP / SEND_USDC or a word like confirm, yes, or send it - relay their reply to use_hive_capability EXACTLY as they typed it: no rephrasing, no added words, and do NOT ask them to confirm again. That exact token finalizes the prepared transaction on the rails; any paraphrase silently fails it and loops.",
  "When the global hive input provides current dashboard context, use it to resolve words like this screen, this view, this section, selected item, or open modal; do not ask the user to repeat visible context unless the provided context is insufficient.",
  "Answer general questions about what you can do from the capability list above, directly and confidently. Use read_hivemind_context to verify read-only app/brain/capability facts, use read_wallet_readiness to verify wallet/payment rail readiness, and use use_hive_capability for actions, OS/app operation, exact file/note edits, balances, or money actions. Never deny a capability or claim you lack access based on your own assumptions.",
  "When the user asks how an agent is doing, or whether one is offline, timing out, stuck, or erroring, call read_agent_status to check the live fleet before you answer - do NOT tell them to look on their own system, and NEVER claim an agent is down, timing out, or failing unless read_agent_status actually shows it. Pass the agent's name (e.g. 'HermesMain'); call it with no name for a fleet-wide health summary.",
  "When read_agent_status shows an agent offline, erroring, or timing out, don't stop at reporting it - OFFER to queue a diagnosis-and-fix job so the hive fixes it itself, and when the user agrees, call create_hive_task (e.g. title 'Diagnose & fix HermesMain timeout', with the status details in the message) so a fleet worker investigates and repairs it. Only create the task after they confirm; a fleet agent, not the user, does the fixing.",
  "When the user asks about Work Board revenue, quoted/open pipeline, forecasts, weekly target, close probability, or approval bottlenecks, call read_work_board with a short revenue/pipeline query and explain that quoted/open pipeline is potential pipeline, not booked or recognized revenue.",
  "Use create_hive_task ONLY when the user clearly asks for longer work to be delegated to the hive (a job, build, fix, research, automation, reminder). If YOU propose the next work after an open-ended prompt like 'you tell me' or 'what should we do', do not call create_hive_task in that same turn - ask whether to queue it, then call create_hive_task only after the user explicitly agrees. Pass a short imperative title and the full request as the message, then briefly confirm what you kicked off using the tool result. NEVER use create_hive_task for a money movement (swap, send, transfer, buy, sell, trade, pay, collect fees) or to confirm one - those are simple, direct actions that use_hive_capability executes on the rails, not work to delegate.",
  "Use drive_dashboard for NAVIGATION and UI setup in the dashboard they are looking at: open or switch a screen (wallets, work board, agents/fleet, chat, schedules, brain), create an agent (optionally naming a runtime, provider, model, or machine), create a wallet for one of their agents, add a task to the board, or open an agent's settings or chat. Pass the user's request VERBATIM as the command; a visible bee flies the interface and clicks for them, and you confirm what happened from the tool result. Prefer drive_dashboard over use_hive_capability for navigating to or opening parts of the app - but NEVER use drive_dashboard to move money: a swap, send, transfer, buy, sell, trade, or payment always goes to use_hive_capability, never drive_dashboard, even when the user is already looking at the Trade or Wallets screen.",
  "When the user states a LASTING preference about how you should talk to or treat them - how to address them ('call me boss'), a language, a tone, or how long your replies should be - call remember_preference with that preference the moment they say it, then confirm naturally. This is what makes the preference stick across future chats; agreeing without calling the tool will not be remembered.",
  "Greetings and chit-chat are just conversation - no tools needed.",
];

export function queenInstructionsForPersonality(personality?: string | null) {
  return [
    formatQueenBeePersonalityInstruction(personality),
    ...QUEEN_OPERATIONAL_INSTRUCTIONS,
  ].join(" ");
}

export const QUEEN_INSTRUCTIONS = queenInstructionsForPersonality();

/** A spoken-style line guidance appended only for the realtime (voice) modality. */
export const QUEEN_VOICE_STYLE =
  " Speak naturally, no lists or markdown. Tool calls take several seconds, so ALWAYS say a brief filler FIRST - 'Let me check…', 'One sec…', 'On it…' - in the same breath before calling a tool, so the user is never left in silence.";

/** Raw tool definitions — shared shape; adapted per modality below. */
export interface QueenToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const QUEEN_TOOL_DEFS: QueenToolDef[] = [
  {
    name: "use_hive_capability",
    description:
      "Discover and execute the best available HivemindOS capability for an arbitrary user goal. This searches registered skills, runtime and MCP tools, connected app APIs, Hive Actions, and specialty agents through the full agent runtime. Use whenever no specific direct Queen tool completely handles the request, including capabilities connected after Queen's prompt was authored. Read-only work runs directly; governed mutations may return an approval or confirmation requirement.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description:
            "The user's complete goal in their own words, plus only the conversation context needed to resolve references.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "create_hive_task",
    description:
      "Create and delegate a task on the HivemindOS work board. Use ONLY when the user clearly requests longer work (build, fix, research, automation, reminder, delegation) or explicitly confirms the task you just proposed. Never call this in the same turn where you invented or selected the task yourself.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative summary of the work." },
        message: { type: "string", description: "The full work request, in the user's words." },
      },
      required: ["message"],
    },
  },
  {
    name: "drive_dashboard",
    description:
      "Navigate and set up the on-screen HivemindOS dashboard the user is looking at: open/switch screens (wallets, work board/kanban, agents/fleet, chat, schedules, brain), create an agent (optionally naming a runtime, provider, model, or machine), create a wallet for a named agent, add a task to the board, or open an agent's settings or chat. A visible honey-bee cursor flies the interface and performs the clicks. Use this for navigation and UI setup only - NOT for executing a money movement (swap, send, buy, sell, trade, transfer, pay), which goes to use_hive_capability.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The user's on-screen request, in their own words (e.g. 'open my wallets', 'create a wallet for my Aeon agent on this Mac', 'create a hermes venice agent', 'draft an X post about the hive').",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "remember_preference",
    description:
      "Save a DURABLE preference about how Queen Bee should address, talk to, or treat the user in future chats - e.g. how to address them ('call me boss'), a preferred language, tone, or how short/long replies should be. Call this the moment the user states such a lasting preference, then confirm it naturally. Do NOT use it for one-off requests, tasks, or facts to look up - only for standing preferences that should persist across sessions.",
    parameters: {
      type: "object",
      properties: {
        preference: {
          type: "string",
          description:
            "The standing preference as a short imperative you can follow later, e.g. 'Address the user as \"boss\".' or 'Keep replies very short.' or 'Reply in Spanish.'",
        },
      },
      required: ["preference"],
    },
  },
  X_ACCOUNT_READ_TOOL_DEF,
];

/**
 * A live-fleet read the Queen offers in BOTH modalities — typed (via
 * QUEEN_CHAT_ONLY_TOOL_DEFS below) and spoken (via queenRealtimeTools). "Is
 * HermesMain timing out?" used to make her assert or deflect instead of
 * checking; now she reads the real telemetry, and on trouble offers a
 * create_hive_task fix (propose-and-confirm — the fleet does the fixing).
 */
const READ_AGENT_STATUS_TOOL_DEF: QueenToolDef = {
  name: "read_agent_status",
  description:
    "Read the LIVE status of the HivemindOS agent fleet directly: whether a named agent is online, reachable, or erroring, which machine and runtime it runs on, a health summary, and its most recent failed runs. Use whenever the user asks how an agent is doing, why one is timing out, stuck, offline, or failing, or to check overall fleet health. Pass agentName to look up one agent (e.g. 'HermesMain'); with no arguments it returns fleet-wide online/offline/error totals. This reads real fleet telemetry - never assert an agent is down or timing out without checking it here first.",
  parameters: {
    type: "object",
    properties: {
      agentName: {
        type: "string",
        description: "Name of the agent to check, e.g. 'HermesMain'. Omit to get fleet-wide status totals.",
      },
    },
    required: [],
  },
};

const READ_WALLET_READINESS_TOOL_DEF: QueenToolDef = {
  name: "read_wallet_readiness",
  description:
    "Read current HivemindOS wallet/payment rail readiness directly from the app without waking a runtime agent. Use for read-only requests like 'open wallets', 'which wallets are ready', 'wallet status', 'wallet readiness', or Bankr/UsePod/Venice/Veil/MoneyClaw/x402/Hyperliquid setup status. It reports configured, spend-ready, gated, and missing-setup rails only; it does NOT fetch balances, deposit/private addresses, or execute spends.",
  parameters: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description:
          "Optional capability lens, usually 'status'. Do not use balance/portfolio/trade/send intents for this read-only tool.",
      },
    },
    required: [],
  },
};

const READ_HIVEMIND_CONTEXT_TOOL_DEF: QueenToolDef = {
  name: "read_hivemind_context",
  description:
    "Read fast, read-only HivemindOS app and local Brain context directly: dashboard/API routes, connected apps, capabilities, runtime/tool surfaces, Shared Brain Memory, compiled brain knowledge, Brain note access history, Work Board/schedule/fleet discovery hints, and what the hive knows about a topic. The user's request authorizes reads of their own local Brain, notes, vault, memories, and access history; do not ask for separate permission. Use before delegating for read-only app-data or Brain questions. Does NOT execute actions, edit notes/files, create tasks, fetch wallet balances, or move money.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The user's read-only app/brain question in their words.",
      },
    },
    required: ["query"],
  },
};

/**
 * Chat-only tools: offered to the TYPED hive input, whose tool loop executes
 * client-side in queen-chat-store. read_work_board is the one here: the typed
 * Queen previously had no way to read the Work Board (only create/delegate),
 * so "what's blocking task X?" sent her hunting through agents and directories
 * instead of the board itself. (read_agent_status and the fast read-only
 * app/brain/wallet tools are also wired into voice below.)
 */
export const QUEEN_CHAT_ONLY_TOOL_DEFS: QueenToolDef[] = [
  READ_HIVEMIND_CONTEXT_TOOL_DEF,
  READ_WALLET_READINESS_TOOL_DEF,
  {
    name: "read_work_board",
    description:
      "Read the HivemindOS Work Board directly: look up a task's current status, assignee, priority, failure reason, and latest result. Use whenever the user asks about a task, blocked or needs-human work, an escalation notification, what a company's crew is doing, or Work Board revenue/quoted pipeline/forecast/weekly target/approval bottlenecks. Pass taskId when you have one (t_…); otherwise pass a search phrase from the task title or a revenue/pipeline query. With neither, returns board totals by status.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Exact Work Board task id, e.g. t_mr4hb1ee_rrv9o." },
        query: { type: "string", description: "Words from the task title to search for when no id is known." },
      },
      required: [],
    },
  },
  READ_AGENT_STATUS_TOOL_DEF,
];

/**
 * OpenAI Realtime format: flat `{ type, name, description, parameters }`. Voice
 * gets the shared core tools PLUS read_agent_status and the fast read-only
 * app/brain/wallet tools. (read_work_board stays typed-only; its executor isn't
 * wired into the realtime session.)
 */
export function queenRealtimeTools() {
  return [
    ...QUEEN_TOOL_DEFS,
    READ_WALLET_READINESS_TOOL_DEF,
    READ_HIVEMIND_CONTEXT_TOOL_DEF,
    READ_AGENT_STATUS_TOOL_DEF,
  ].map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/** OpenAI Chat Completions format: nested `{ type, function: {...} }`. */
export function queenChatTools() {
  return [...QUEEN_TOOL_DEFS, ...QUEEN_CHAT_ONLY_TOOL_DEFS].map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

const QUEEN_PIPELINE_TOOL_NAMES = new Set([
  "read_hivemind_context",
  "read_x_account",
  "use_hive_capability",
]);

/** Server-executable tools offered by the direct pipeline voice/text lane. */
export function queenPipelineChatTools() {
  return queenChatTools().filter((tool) => QUEEN_PIPELINE_TOOL_NAMES.has(tool.function.name));
}

/** Tool names the dashboard CLIENT must execute (UI driving); the rest are server actions. */
export const QUEEN_CLIENT_TOOLS = ["drive_dashboard"] as const;

/** A near-whole-message affirmative — the user agreeing to the task the Queen
 *  just offered ("yes", "queue it", "go ahead", optionally with a trailing
 *  clause like "yes please do"). */
const TASK_AFFIRMATIVE_RE =
  /^(yes|yeah|yep|sure|ok(ay)?|do it|go ahead|go for it|please do|sounds good|confirm(ed)?|queue it|create it|make it|add it|ship it)\b[\s,!.]*(please|thanks|thank you)?[\s!.]*$/i;

/** Work-request verbs/nouns that make task creation plausible anywhere in the
 *  message ("fix the collector", "queue a research job", "remind me…"). */
const TASK_WORK_INTENT_RE =
  /\b(queue|task|job|delegate|assign|fix|repair|diagnose|build|create|add|make|write|generate|research|investigate|look into|automate|automation|remind(er)?|schedule|deploy|set ?up|work on|handle|take care|get .{0,40}(back )?(online|running|working))\b/i;

const WALLET_READINESS_HINT_RE =
  /\b(wallets?|wallet\s+rails?|rails?|payment\s+rails?|crypto\s+rails?|spend[-\s]?ready|readiness|configured|setup|set\s+up|status|open|show|list|which|available|enabled|gated|blocked|bankr|usepod|use\s*pod|venice|veil|money\s*claw|moneyclaw|x402|hyperliquid|clawbank)\b/i;

const WALLET_READINESS_REQUIRED_RE =
  /\b(wallets?|wallet\s+rails?|payment\s+rails?|crypto\s+rails?|bankr|usepod|use\s*pod|venice|veil|money\s*claw|moneyclaw|x402|hyperliquid|clawbank)\b/i;

const WALLET_ACTION_OR_BALANCE_RE =
  /\b(balance|balances|portfolio|pnl|deposit|deposit\s+address|address|receive|send|swap|trade|buy|sell|transfer|pay|withdraw|bridge|claim|fund|top\s*up|quote|order|position|positions|confirm|confirmation)\b/i;

const WALLET_META_CONTEXT_RE =
  /\b(route|routes|api|code|source|docs?|screen|dashboard|component|file|implementation)\b/i;

const HIVEMIND_FAST_CONTEXT_SUBJECT_RE =
  /\b(hivemind(?:os)?|app|dashboard|screen|route|api|data|state|brain|memory|memories|vault|notes?|knowledge|compiled\s+brain|work\s+board|kanban|tasks?|schedules?|automations?|agents?|fleet|runtimes?|tools?|skills?|capabilit(?:y|ies)|connected\s+apps?|settings|status)\b/i;

const HIVEMIND_FAST_CONTEXT_QUERY_RE =
  /\b(what|which|who|where|when|why|how|show|list|search|find|look\s*up|summari[sz]e|tell|status|do\s+we\s+have|does\s+.*\s+have|is\s+there|are\s+there|what'?s|what\s+is|what\s+are)\b/i;

const HIVEMIND_FAST_CONTEXT_ACTION_RE =
  /\b(create|add|edit|write|save|remember|delete|remove|archive|send|swap|trade|buy|sell|transfer|pay|withdraw|bridge|claim|fund|top\s*up|open|launch|run|execute|deploy|fix|repair|install|restart|kill|commit|push|publish|call|message|email)\b/i;

const HIVE_LATEST_SUBJECT_RE =
  /\b(?:hive|hivemind(?:os)?|queen\s*bee|agents?|fleet|work\s*board|kanban|dashboard|brain|memory|vault|schedules?|automations?)\b/i;

const BARE_HIVE_LATEST_RE = new RegExp(
  [
    "^\\s*(?:hey|hi|yo|gm|morning)?\\s*(?:queen(?:\\s*bee)?[,!]?\\s*)?",
    "(?:",
    "(?:what(?:'|’)?s|whats|what\\s+is)\\s+(?:the\\s+)?(?:latest|new|newest|happening|going\\s+on|update|updates|pulse|brief)",
    "|(?:any\\s+)?(?:latest|updates?|news|pulse|brief)",
    "|(?:catch\\s+me\\s+up|update\\s+me)",
    ")",
    "(?:\\s+(?:in|inside|with|from|across|around|on)\\s+(?:the\\s+)?(?:hive|hivemind(?:os)?|queen\\s*bee|agents?|fleet|work\\s*board|kanban|dashboard|brain|memory|vault|schedules?|automations?))?",
    "\\s*[?.!]*\\s*$",
  ].join(""),
  "i",
);

/**
 * Read-only wallet readiness can be answered from the app capability matrix.
 * Balances and state-changing actions stay on use_hive_capability because those
 * routes touch real wallet rails and confirmation state.
 */
export function isWalletReadinessCommand(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || WALLET_META_CONTEXT_RE.test(trimmed) || WALLET_ACTION_OR_BALANCE_RE.test(trimmed)) return false;
  return WALLET_READINESS_REQUIRED_RE.test(trimmed) && WALLET_READINESS_HINT_RE.test(trimmed);
}

/**
 * Broad read-only app/brain questions should hit the dashboard/brain indexes
 * directly. Anything mutating, OS-driving, wallet-balancing, or money-moving
 * stays on specific tools or use_hive_capability.
 */
export function isHivemindFastContextCommand(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || isWalletReadinessCommand(trimmed)) return false;
  if (WALLET_ACTION_OR_BALANCE_RE.test(trimmed) || HIVEMIND_FAST_CONTEXT_ACTION_RE.test(trimmed)) return false;
  if (isHivemindLatestBriefCommand(trimmed)) return true;
  return HIVEMIND_FAST_CONTEXT_SUBJECT_RE.test(trimmed) && HIVEMIND_FAST_CONTEXT_QUERY_RE.test(trimmed);
}

export function isHivemindLatestBriefCommand(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 160) return false;
  if (isWalletReadinessCommand(trimmed)) return false;
  if (WALLET_ACTION_OR_BALANCE_RE.test(trimmed) || HIVEMIND_FAST_CONTEXT_ACTION_RE.test(trimmed)) return false;
  if (BARE_HIVE_LATEST_RE.test(trimmed)) return true;
  return /\b(?:latest|new|happening|updates?|pulse|brief)\b/i.test(trimmed)
    && HIVE_LATEST_SUBJECT_RE.test(trimmed)
    && HIVEMIND_FAST_CONTEXT_QUERY_RE.test(trimmed);
}

/**
 * Mechanical enforcement of the propose-then-confirm contract for
 * create_hive_task. The instructions above already forbid the Queen from
 * queueing Work Board tasks she invented herself ("Only create the task after
 * they confirm"), but small brains ignore them: on 2026-07-06 Scout answered a
 * bare "hi" by reading fleet status and unilaterally creating a "Fix agent
 * errors" task. Executors call this with the user message that started the
 * turn; when it returns false the tool call must NOT run — hand the model a
 * result telling it to ask the user instead. Fails safe: the worst false
 * negative costs one extra "yes" from the user.
 */
export function userAuthorizedHiveTaskCreation(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed) return false;
  return TASK_AFFIRMATIVE_RE.test(trimmed) || TASK_WORK_INTENT_RE.test(trimmed);
}

/**
 * WHOLE-MESSAGE greeting / chit-chat / thanks — a turn that needs no tools at
 * all. The regex is anchored end-to-end ON PURPOSE: only messages that are a
 * pure greeting and NOTHING else match. A greeting that PREFIXES a real ask
 * ("hey queen, is HermesMain down?", "gm, swap 1 usdc to eth", "thanks, now
 * open my wallets", "how are you doing on the collector fix?") must NOT match,
 * because the tools those asks need (read_agent_status, use_hive_capability,
 * drive_dashboard) are mandatory — so the address list after the greeting is a
 * closed set (queen/boss/there/…), and any real word breaks the match and
 * restores tools. Deliberately EXCLUDES affirmatives (yes/ok/sure) — those are
 * owned by userAuthorizedHiveTaskCreation and may authorize an action.
 */
// One greeting/thanks/how-are-you phrase.
const GREETING_PHRASE =
  "h+i+|h+ey+|hey+a|hiya|hello+|yo+|sup|wa?ss?up|what'?s?\\s?up|howdy|hola|henlo|gm|greetings|good\\s?(?:morning|afternoon|evening|day)|mornin[g']?|evenin[g']?|afternoon|thank\\s?(?:you|u)|thanks|thankyou|ty|tysm|thx|cheers|much\\s?appreciated|appreciate\\s?(?:it|that)|appreciated|how\\s?(?:are|r|'?re)\\s?(?:you|ya|u)(?:\\s?doing)?|how'?s?\\s?it\\s?goin['g]?|how\\s?goes\\s?it|how\\s?you\\s?doin['g]?|hru";
// Closed set of trivial trailing tokens (forms of address + temporal chit-chat).
// Any word NOT in this set breaks the match and restores tools — that is what
// keeps "hey queen, is HermesMain down?" out.
const TRIVIAL_TRAILER = "queen(?:\\s?bee)?|bee|boss|there|everyone|all|mate|friend|team|folks|y'?all|guys?|today|tonight";
// The whole message = one-or-more greeting phrases, each with optional trailers,
// separated only by trivial punctuation. Length-capped by the caller to bound
// backtracking. Chained greetings ("hi how are you today") match; a real ask
// after the greeting does not.
const TRIVIAL_CONVERSATION_RE = new RegExp(
  `^[\\s!.,?~]*(?:(?:${GREETING_PHRASE})(?:\\s*[,\\-]?\\s*(?:${TRIVIAL_TRAILER}))*[\\s!.,?~]*)+$`,
  "i",
);

/**
 * True when the user's whole message is a bare greeting/chit-chat that warrants
 * a conversational reply with NO tool calls. Small brains (Scout, 12B) ignore
 * the "Greetings and chit-chat are just conversation - no tools needed"
 * instruction and fire read_work_board/read_agent_status on a bare "hi" — which
 * renders as a greeting, a tool-spin, then a second unsolicited paragraph
 * (2026-07-06). The typed tool loop calls this and, when true, forces a
 * no-tools reply on the first round. Fails safe: a false negative just lets a
 * greeting run tools (the prior behavior); a false positive would only suppress
 * tools on a message that is, by construction, nothing but a greeting.
 */
export function isTrivialConversationalTurn(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 60) return false;
  return TRIVIAL_CONVERSATION_RE.test(trimmed);
}
