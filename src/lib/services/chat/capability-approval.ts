import { createHash } from "crypto";
import { searchContextIndexBatch, type ContextConnectedApp, type ContextIndexItem } from "@/lib/services/context-index";
import { connectedAppsForTaskRetrieval } from "@/lib/services/chat/task-retrieval-context";
import {
  CAPABILITY_APPROVAL_CONTINUATION_MARKER,
  selectedCapability,
  type CapabilityApprovalItem,
  type CapabilityApprovalPlan,
  type CapabilityCandidate,
  type CapabilityDecision,
  type CapabilitySetupOption,
} from "@/lib/types/capability-approval";
import { githubCapabilityForContextId } from "@/lib/services/github-capability-catalog";
import { readInstallableServiceStatus } from "@/lib/services/installable-services";
import { isConcreteHyperframesVideoRequest } from "@/lib/services/chat/hyperframes-prompt";
import { applyAppPreferences, readAppPreferences } from "@/lib/services/fleet/app-preferences";
import {
  chatPermissionModeSkipsReadyCapabilityReview,
  normalizeChatPermissionMode,
  type ChatPermissionMode,
} from "@/lib/types/chat-permissions";
import { capabilityExecutionReceiptRequired } from "@/lib/services/chat/approved-runtime-capabilities";

const CAPABILITY_SEARCH_KINDS = ["skill", "tool-schema", "api-route", "connected-app", "app-endpoint", "connector", "runtime"] as const;
const MAX_CANDIDATES_PER_ITEM = 8;
const SEARCH_CANDIDATE_LIMIT = 80;
const SEARCH_SKILL_CANDIDATE_LIMIT = 40;

type CapabilityIntent = {
  id: string;
  label: string;
  reason: string;
  query: string;
  matches: (task: string) => boolean;
  candidatePattern: RegExp;
  primaryCandidatePattern?: RegExp;
  preferredCandidatePattern?: RegExp;
  rejectCandidate?: (context: CapabilityRequestContext, candidateText: string, candidate: ContextIndexItem) => boolean;
};

type CapabilityRequestContext = {
  task: string;
  intentTaskContext: string;
  workingDirectory?: string;
};

const SOFTWARE_TARGET_PATTERN = /\b(app|application|website|web\s*app|page|dashboard|service|server|software|workflow|automation|integration|api|feature|system|tool|scraper|code|codebase|bug|frontend|backend|mcp|tts|checkout|component|extension|script|cli|command[-\s]line|library|package)\b/i;
const HIVEMINDOS_FEATURE_CAPABILITY_PATTERN = /\bhivemindos-feature-development\b/i;
const HIVEMINDOS_CHECKOUT_PATTERN = /(?:^|[\\/])hivemind-os(?:[\\/]|$)/i;
const HIVEMINDOS_PRODUCT_TARGET_PATTERN = /\b(?:hivemind\s*os|hivemindos)\s+(?:app(?!\s+builder)|chat|codebase|dashboard|desktop\s+app|feature|fleet|repo(?:sitory)?|runtime)\b/i;
const APP_WORKSPACE_ACTION_PATTERN = /\b(build|create|make|prototype|develop|code)\b/i;
const APP_WORKSPACE_TARGET_PATTERN = /\b(web\s*app|website|landing\s+page|web\s+page|dashboard|game|clone|application|app)\b/i;
const APP_WORKSPACE_CONTEXTUAL_OUTPUT_PATTERN = /\b(api|automation|bug|checkout|cli|command[-\s]line|component|document|email|extension|feature|graphic|icon|image|integration|library|logo|mockup|package|pdf|photo|picture|plan|plugin|report|script|server|service|slides?|spreadsheet|tool|video|wireframe|workflow|workbook)\b[\s\S]{0,80}\b(?:for|inside|into|on|to|within)\b(?:\s+[a-z0-9'-]+){0,4}\s*$/i;
const APP_WORKSPACE_SUBJECT_OUTPUT_PATTERN = /^\s*(?:(?:['’]s|for)\s+(?:[a-z0-9-]+\s+){0,2})?(?:api|bug|checkout|component|design\s+document|document|engine|extension|feature|graphic|icon|image|integration|logo|mockup|outline|plan|plugin|screenshot|wireframe)\b/i;
const APP_WORKSPACE_UNSUPPORTED_TARGET_PATTERN = /\b(android|desktop\s+app|flutter|ios|kotlin|macos|mobile\s+app|native\s+app|notion\s+page|react\s+native|swiftui?|windows\s+(?:desktop\s+)?app)\b/i;
const PRIMARY_ARTIFACT_ACTION_PATTERN = /\b(build|create|design|draw|generate|make|produce|record|render)\b/i;
const PRIMARY_NON_SOFTWARE_ARTIFACT_PATTERN = /\b(excel|graphic|icon|image|logo|mockup|pdf|photo|picture|power\s*bi|slides?|spreadsheet|tableau|video|wireframe|workbook)\b/i;
const NON_SOFTWARE_SUBJECT_OUTPUT_PATTERN = /^\s*(?:(?:['’]s|for)\s+(?:[a-z0-9-]+\s+){0,2})?(?:graphic|icon|image|logo|mockup|photo|picture|screenshot|wireframe)\b/i;

function explicitHivemindosRepositoryRequest(task: string) {
  return HIVEMINDOS_PRODUCT_TARGET_PATTERN.test(task)
    || /\b(?:fix|modify|refactor|repair|update)\b[\s\S]{0,100}\b(?:hivemind\s*os|hivemindos)\b/i.test(task)
    || /\b(?:add|implement)\b[\s\S]{0,100}\b(?:in|into|to)\s+(?:the\s+)?(?:hivemind\s*os|hivemindos)(?:\s+app)?\b/i.test(task)
    || /\b(?:chat|fleet|queen|wallet)\b[\s\S]{0,80}\b(?:in|inside)\s+(?:hivemind\s*os|hivemindos)\b/i.test(task);
}

function hivemindosRepositoryContext(task: string, workingDirectory?: string) {
  return explicitHivemindosRepositoryRequest(task) || HIVEMINDOS_CHECKOUT_PATTERN.test(workingDirectory ?? "");
}

function dataDashboardRequest(task: string) {
  return /\b(excel|power\s*bi|spreadsheet|tableau|workbook)\b[\s\S]{0,80}\bdashboard\b/i.test(task);
}

function primaryNonSoftwareArtifactRequest(task: string) {
  if (dataDashboardRequest(task)) return true;
  const action = PRIMARY_ARTIFACT_ACTION_PATTERN.exec(task);
  if (!action) return false;
  const actionBody = task.slice((action.index ?? 0) + action[0].length, (action.index ?? 0) + action[0].length + 180);
  const artifact = PRIMARY_NON_SOFTWARE_ARTIFACT_PATTERN.exec(actionBody);
  if (!artifact) return false;
  const softwareTarget = SOFTWARE_TARGET_PATTERN.exec(actionBody);
  if (!softwareTarget || artifact.index < softwareTarget.index) return true;
  return NON_SOFTWARE_SUBJECT_OUTPUT_PATTERN.test(actionBody.slice(softwareTarget.index + softwareTarget[0].length));
}

function appWorkspaceRequest(task: string) {
  if (/\b(?:this|current|existing)\s+(?:repo|repository|codebase|project)\b/i.test(task)) return false;
  if (APP_WORKSPACE_UNSUPPORTED_TARGET_PATTERN.test(task) || dataDashboardRequest(task)) return false;
  const action = APP_WORKSPACE_ACTION_PATTERN.exec(task);
  if (!action) return false;
  const actionBody = task.slice((action.index ?? 0) + action[0].length, (action.index ?? 0) + action[0].length + 180);
  const target = APP_WORKSPACE_TARGET_PATTERN.exec(actionBody);
  if (!target) return false;
  const targetIndex = (action.index ?? 0) + action[0].length + target.index;
  const hivemindosProductTarget = HIVEMINDOS_PRODUCT_TARGET_PATTERN.exec(task);
  if (hivemindosProductTarget && hivemindosProductTarget.index <= targetIndex) return false;
  const beforeTarget = actionBody.slice(0, target.index);
  if (APP_WORKSPACE_CONTEXTUAL_OUTPUT_PATTERN.test(beforeTarget)) return false;
  const afterTarget = actionBody.slice(target.index + target[0].length);
  return !APP_WORKSPACE_SUBJECT_OUTPUT_PATTERN.test(afterTarget);
}

function recurringAutomationRequest(task: string) {
  return /\b(recurring|daily|weekly|hourly|monthly|cron|every\s+(?:day|week|hour|month|morning|evening))\b/i.test(task)
    && !/\b(appointment|availability|book(?:ing)?|calendar|cal\.?(?:com)?|calendly|meeting)\b/i.test(task);
}

function nonExecutingRequest(task: string) {
  const value = task.trim().replace(/^please\s+/i, "");
  if (/^(?:explain|describe|summari[sz]e|review|show\s+me\s+how|tell\s+me\s+(?:how|what|why|about)|how\s+(?:do|does|can|should|would|to)\b|what\s+(?:is|are|does|do)\b|why\b)/i.test(value)) return true;
  const planFirst = /^(?:create|draft|write|make|build|develop|design)\s+(?:me\s+)?(?:(?:a|an|the)\s+)?(?:[a-z0-9-]+\s+){0,3}(?:plan|outline|proposal|strategy|roadmap)\b/i.test(value);
  const laterExecution = /\b(?:and|then)\s+(?:build|develop|implement|code|ship|deploy|create|generate|produce)\b/i.test(value);
  return planFirst && !laterExecution;
}

function softwareImplementationRequest(task: string) {
  if (primaryNonSoftwareArtifactRequest(task)) return false;
  return explicitHivemindosRepositoryRequest(task)
    || /\b(add|build|develop|implement|code|modify|repair|refactor|ship|update|set\s*up|install|design|prototype|create|make)\b[\s\S]{0,180}/i.test(task) && SOFTWARE_TARGET_PATTERN.test(task)
    || /\bwrite\b[\s\S]{0,120}\b(code|script|cli|command[-\s]line|tool|library|package)\b/i.test(task)
    || /\bfix\b[\s\S]{0,180}\b(app|application|website|web\s*app|service|software|code|codebase|bug|frontend|backend|api|feature|system|tool)\b/i.test(task)
    || /\b(app|application|website|web\s*app|service|software|code|codebase|bug|frontend|backend|api|feature|system|tool)\b[\s\S]{0,180}\b(?:fix|repair|refactor)\b/i.test(task);
}

/**
 * Capability families are intentionally centralized. Adding a new family here
 * updates chat planning without scattering provider-name conditionals through
 * the API and UI.
 */
export const CAPABILITY_APPROVAL_INTENTS: CapabilityIntent[] = [
  {
    id: "implementation",
    label: "Implementation",
    reason: "Build, change, or repair the requested product through the project’s established engineering workflow.",
    query: "software implementation coding debugging testing application feature development",
    matches: softwareImplementationRequest,
    candidatePattern: /\b(hivemindos-feature-development|engineering-discipline|test-driven-development|systematic-debugging|software[-\s]+(?:implementation|development)|application[-\s]+development|feature[-\s]+development|frontend-design|backend[-\s]+development|vercel-react-best-practices)\b/i,
    primaryCandidatePattern: /\b(hivemindos-feature-development|feature[-\s]+development)\b/i,
    preferredCandidatePattern: /\b(hivemindos-feature-development|engineering-discipline|feature[-\s]+development|test-driven-development)\b/i,
    rejectCandidate: (context, candidate) => (
      HIVEMINDOS_FEATURE_CAPABILITY_PATTERN.test(candidate) && !hivemindosRepositoryContext(context.task, context.workingDirectory)
    ) || (/\bcodebase[-\s]+inspection\b/i.test(candidate) && /\b(pygount|loc|languages?|ratios?)\b/i.test(candidate)),
  },
  {
    id: "app-builder",
    label: "App workspace",
    reason: "Create a durable project whose files, runtime, and preview stay attached to this conversation.",
    query: "app workspace app builder apps.build app_builder Replit Lovable local project preview website game",
    matches: appWorkspaceRequest,
    candidatePattern: /\b(app[-\s]?(?:builder|workspace)|apps\.build|create\s+app\s+workspace|replit|lovable)\b/i,
    primaryCandidatePattern: /\b(hive-action:apps\.build|create\s+app\s+workspace)\b/i,
    preferredCandidatePattern: /\b(app[-\s]?(?:builder|workspace)|apps\.build|create\s+app\s+workspace)\b/i,
  },
  {
    id: "research",
    label: "Research",
    reason: "Gather and verify the information the task depends on.",
    query: "research web search browse sources analyze compare investigate latest information",
    matches: (task) => /\b(research|search|browse|analy[sz]e|investigate|compare|find|latest|news|sources?)\b/i.test(task),
    candidatePattern: /\b(research|web\s+search|browser\s+use|source\s+gathering|news\s+search|investigat|fact.?check|storm-research)\b/i,
    preferredCandidatePattern: /\b(storm-research|browser\s+use|web\s+search|wiki-first-research)\b/i,
    rejectCandidate: ({ task }, candidate) => !/\b(thesis|investment|market|trade|token|equity|quant)\b/i.test(task) && /\b(kill-my-thesis|investment\s+thesis|trading\s+research|quant\s+research)\b/i.test(candidate),
  },
  {
    id: "interface-design",
    label: "Interface design",
    reason: "Design and implement the user-facing experience requested by the task.",
    query: "frontend design ui ux interface web app dashboard landing page design system",
    matches: (task) => !dataDashboardRequest(task)
      && !/^\s*(?:connect|install|set\s*up)\b/i.test(task)
      && /\b(ui|ux|interface|frontend|dashboard|landing\s+page|web\s*app|website|design\s+system|react|component|mobile\s+app)\b/i.test(task),
    candidatePattern: /\b(frontend|ui|ux|interface|landing\s+page|web\s+design|design\s+system|react|component)\b/i,
    preferredCandidatePattern: /\b(frontend-design|landing-page|ui-ux-pro-max)\b/i,
  },
  {
    id: "image-generation",
    label: "Image generation",
    reason: "Create the requested photos, illustrations, graphics, or other still-image assets.",
    query: "image generation photo illustration graphic visual asset imagegen comfyui generative media",
    matches: (task) => /\b(image|photo|picture|illustration|graphic|thumbnail|poster|banner|logo|icon|visual\s+asset)\b/i.test(task),
    candidatePattern: /\b(image\s+(?:generation|generator|editing)|imagegen|photo\s+generation|illustration|text.?to.?image|txt2img|comfyui|generative\s+(?:image|media)|media\s+studio)\b/i,
    preferredCandidatePattern: /\b(image\s+(?:generation|generator|editing)|text.?to.?image|photo\s+generation)\b/i,
  },
  {
    id: "video-generation",
    label: "Video generation",
    reason: "Create or assemble the requested video, animation, reel, or motion asset.",
    query: "text-to-video image-to-video generative video API connected media MCP",
    matches: (task) => !/\bdownload(?:s|ed|ing)?\b/i.test(task)
      && /\b(video|animation|reel|clip|movie|motion\s+graphic|image[-\s]?to[-\s]?video)\b/i.test(task),
    candidatePattern: /\b(video[-\s]+(?:generation|generator|assembly|render)|animation|image.?to.?video|text.?to.?video|short[-\s]+video|generative[-\s]+(?:video|media)(?:[-\s]+mcp)?|media[-\s]+(?:generation|studio|gateway)|generate[-\s]+(?:hosted[-\s]+)?media|hosted[-\s]+media|app\s+kind:\s*media)\b/i,
    rejectCandidate: (context, candidate, candidateItem) => {
      const requestedVideoWork = context.intentTaskContext || context.task;
      const candidateIdentity = `${candidateItem.id} ${candidateItem.title}`;
      if (/\b(?:video[-\s]+)?(?:prompt(?:ing)?|prompt[-\s]+(?:guide|optimizer)|render[-\s]+qa|quality[-\s]+assurance|analy[sz](?:er|is)|transcript(?:ion)?)\b/i.test(candidateIdentity)
        || /\b(?:class[-\s]+level|capability)[-\s]+(?:playbook|router|umbrella)\b/i.test(candidateItem.summary)) return true;
      if ((candidateItem.kind === "connected-app" || candidateItem.kind === "app-endpoint")
        && !/\b(?:app capabilities:[^.]*\b(?:video|image-to-video|text-to-video)|mcp video generation configured|text.?to.?video|image.?to.?video|video generation|generate(?:s|d|ing)?[^.]{0,80}\bvideo|video[^.]{0,80}\b(?:generate|generation|production)|comfyui proxy)\b/i.test(candidateItem.summary)) return true;
      if (!/\b(launch|promo|startup|product\s+demo)\b/i.test(requestedVideoWork)
        && /\b(?:launch|startup|product[-\s]+demo|viral[-\s]+startup)[-\s]+video\b/i.test(candidateIdentity)) return true;
      if (/\bwebsite-to-video\b/i.test(candidate)
        && !/\b(?:existing|current|live)\s+(?:website|site)|\b(?:website|site)\s+(?:tour|showcase|capture)|\burl\b|https?:\/\//i.test(requestedVideoWork)) return true;
      if (/\bpr-to-video\b/i.test(candidate) && !/\b(?:pull\s+request|github\s+pr|pr\s*#?\d+)\b/i.test(requestedVideoWork)) return true;
      if (/\bremotion-to-hyperframes\b/i.test(candidate) && !/\bremotion\b/i.test(requestedVideoWork)) return true;
      if (/\bshort-video-assembly\b/i.test(candidate)
        && !/\b(?:assemble|combine|concatenate|edit|existing|mux|narration|stitch|subtitles?|clips?|footage|music)\b/i.test(requestedVideoWork)) return true;
      return false;
    },
  },
  {
    id: "presentation",
    label: "Presentation",
    reason: "Create the requested slide deck or presentation in the appropriate editable format.",
    query: "PowerPoint presentation slide deck pptx keynote Google Slides presentation design",
    matches: (task) => /\b(power\s*point|pptx?|presentation|slide\s+deck|slides?|keynote)\b/i.test(task),
    candidatePattern: /\b(power\s*point|pptx?|presentation|slide\s+deck|google\s+slides|keynote)\b/i,
    preferredCandidatePattern: /\b(powerpoint|presentations|google\s+slides)\b/i,
  },
  {
    id: "document",
    label: "Document",
    reason: "Create or edit the requested document or PDF artifact.",
    query: "document creation PDF brochure DOCX Word document editing publishing",
    matches: (task) => /\b(pdf|docx?|word\s+document|brochure|document)\b/i.test(task),
    candidatePattern: /\b(document|docx?|word|pdf|brochure|nano-pdf)\b/i,
    preferredCandidatePattern: /\b(documents|nano-pdf|pdf)\b/i,
    rejectCandidate: ({ task }, candidate) => /\b(create|make|generate|produce)\b/i.test(task) && /\b(ingestion|extract(?:ion)?|ocr|read-only)\b/i.test(candidate),
  },
  {
    id: "audio-generation",
    label: "Audio generation",
    reason: "Generate the requested narration, speech, podcast, music, or other audio artifact.",
    query: "audio generation text to speech TTS narration podcast music sound voice local TTS",
    matches: (task) => !/\b(transcrib(?:e|es|ed|ing)|transcript(?:ion)?|speech[-\s]?to[-\s]?text)\b/i.test(task)
      && /\b(audio|text[-\s]?to[-\s]?speech|tts|narrat(?:e|ed|ion)|podcast|speech|voiceover|music|sound\s+effect)\b/i.test(task),
    candidatePattern: /\b(audio|text.?to.?speech|tts|narration|podcast|speech|voice|music|sound)\b/i,
    preferredCandidatePattern: /\b(localtts|local\s+tts|text.?to.?speech|tts|audio\s+generation|voice-cloning-tts)\b/i,
  },
  {
    id: "three-dimensional",
    label: "3D creation",
    reason: "Create, convert, preview, or optimize the requested three-dimensional asset.",
    query: "3D model avatar GLB VRM mesh generation modeling character asset",
    matches: (task) => /\b(3d|three[-\s]?dimensional|glb|gltf|vrm|mesh|3d\s+model|3d\s+avatar)\b/i.test(task),
    candidatePattern: /\b(3d|glb|gltf|vrm|mesh|model\s+preview|modeling|avatar)\b/i,
    preferredCandidatePattern: /\b(add-stylized-character|mesh-decimator|vrm-optimizer|model-previewer)\b/i,
  },
  {
    id: "diagramming",
    label: "Diagramming",
    reason: "Create the requested architecture, process, or technical diagram.",
    query: "architecture diagram flowchart technical diagram Excalidraw Mermaid SVG visualization",
    matches: (task) => /\b(architecture\s+diagram|flow\s*chart|diagram|excalidraw|mermaid)\b/i.test(task),
    candidatePattern: /\b(architecture.?diagram|flow\s*chart|diagram|excalidraw|mermaid)\b/i,
    preferredCandidatePattern: /\b(architecture-diagram|excalidraw|mermaid)\b/i,
  },
  {
    id: "mcp-development",
    label: "MCP development",
    reason: "Build or extend the requested Model Context Protocol server, app, or integration.",
    query: "MCP server Model Context Protocol MCP app MCP integration tool development",
    matches: (task) => /\b(mcp|model\s+context\s+protocol)\b/i.test(task),
    candidatePattern: /\b(mcp|model\s+context\s+protocol)\b/i,
    preferredCandidatePattern: /\b(build-mcp-server|build-mcp-app|mcp-integration|native-mcp)\b/i,
  },
  {
    id: "browser-automation",
    label: "Browser automation",
    reason: "Inspect or operate browser-based products needed to complete the task.",
    query: "browser automation chrome computer use website interaction web navigation scraping forms",
    matches: (task) => /\b(browser|chrome|scrap(?:e|er|ing)|fill(?:s|ing)?\s+forms?|click(?:s|ing)?|navigat(?:e|ion|ing)|computer\s+use)\b/i.test(task),
    candidatePattern: /\b(browser|chrome|computer\s+use|web\s+automation|scrap(?:e|ing)|playwright|selenium)\b/i,
    preferredCandidatePattern: /\b(browser\s+use|browser|chrome|computer-use)\b/i,
  },
  {
    id: "deployment",
    label: "Deployment",
    reason: "Publish or host the completed result on the requested platform.",
    query: "deploy deployment hosting cloudflare vercel site hosting app release publishing",
    matches: (task) => /\b(deploy|deployment|host|hosting|cloudflare|vercel)\b/i.test(task)
      || /\bpublish\b[\s\S]{0,80}\b(site|website|web\s+app|application|page)\b/i.test(task)
      || /\brelease\b[\s\S]{0,80}\b(app|application|software|package|version)\b/i.test(task),
    candidatePattern: /\b(deploy|deployment|hosting|cloudflare|vercel|pages|site\s+publishing|app\s+release)\b/i,
    preferredCandidatePattern: /\b(cloudflare|wrangler|sites-hosting|vercel|liamvisionary-subdomain-publishing)\b/i,
    rejectCandidate: ({ task }, candidate) => /\b(agentic[-\s]+inbox|email[-\s]+agent|modal-serverless-llm|deploy\s+a\s+hivemindos\s+machine)\b/i.test(candidate)
      || (!/\b(email|inbox|mail|smtp|routing)\b/i.test(task) && /\b(cloudflare[-\s]+email|email[-\s]+service|email[-\s]+routing|transactional[-\s]+email)\b/i.test(candidate))
      || (/\bcloudflare\b/i.test(task) && !/\b(cloudflare(?:\s+(?:management|pages|workers))?|wrangler|deploy|deployment|hosting|sites-hosting)\b/i.test(candidate)),
  },
  {
    id: "communications",
    label: "Communications",
    reason: "Draft or deliver messages through the requested communication channel.",
    query: "email messaging gmail telegram slack social post notification delivery X Twitter",
    matches: (task) => /\b(emails?|messages?|gmail|telegram|slack|notif(?:y|ies|ied|ication|ications)|social\s+posts?|tweets?|post(?:s|ing)?\s+to|publish(?:es|ed|ing)?\s+(?:an?\s+)?(?:x|twitter|social))\b/i.test(task)
      || /\b(?:x|twitter)\s+posts?\b/i.test(task),
    candidatePattern: /\b(email|messaging|gmail|telegram|slack|notification|delivery|social\s+post|twitter|x\s+api|xurl|postiz)\b/i,
    preferredCandidatePattern: /\b(x\s*\/\s*twitter\s+integration|x\s+api\s+mcp|xurl|send\s+a\s+slack\s+message|gmail|telegram)\b/i,
    rejectCandidate: ({ task }, candidate) => !/\b(miroshark|simulation)\b/i.test(task) && /\b(miroshark|simulation\/.+posts|simulation\s+posts|posthog)\b/i.test(candidate),
  },
  {
    id: "data-work",
    label: "Data work",
    reason: "Read, transform, or produce the structured data required by the task.",
    query: "spreadsheet Excel CSV workbook Power BI Tableau database analytics data analysis charts tables",
    matches: (task) => /\b(spreadsheets?|excel|csv|tsv|workbooks?|power\s*bi|tableau|database|datasets?|data\s+analysis|analy[sz](?:e|es|ed|ing)\s+(?:a\s+)?(?:csv|dataset|spreadsheet|workbook))\b/i.test(task),
    candidatePattern: /\b(spreadsheets?|excel|csv|tsv|workbook|power\s*bi|tableau|database|data\s+analysis|google\s+sheets)\b/i,
    preferredCandidatePattern: /\b(spreadsheets?|excel|power\s*bi|tableau|google\s+sheets)\b/i,
  },
  {
    id: "payments",
    label: "Payments",
    reason: "Use the appropriate payment, wallet, or paid-API rail for the task.",
    query: "payment wallet Stripe checkout card billing Square x402 crypto USDC Bankr paid API transaction",
    matches: (task) => /\b(payments?|wallet|stripe|checkout|card\s+billing|billing|square|x402|crypto|usdc|bankr|paid\s+api|purchase|transaction)\b/i.test(task),
    candidatePattern: /\b(payment|wallet|stripe|checkout|billing|square|x402|crypto|usdc|bankr|transaction)\b/i,
    preferredCandidatePattern: /\b(stripe-payment-integration|self-serve-payment-funnel|crypto\s+capability\s+router|agent\s+wallet\s+tools)\b/i,
    rejectCandidate: ({ task }, candidate) => /\bstripe\b/i.test(task) && !/\bstripe\b/i.test(candidate),
  },
  {
    id: "media-download",
    label: "Media download",
    reason: "Download the requested source media, audio, subtitles, or metadata locally.",
    query: "yt-dlp youtube video audio media download subtitles metadata local downloader",
    matches: (task) => /\byt[-\s]?dlp\b/i.test(task) || /\bdownload\b[\s\S]{0,100}\b(video|audio|youtube|media|subtitles?)\b/i.test(task),
    candidatePattern: /\b(yt[-\s]?dlp|video\s+downloader|audio\s+downloader|download\s+(?:video|media)|fetch\s+subtitles)\b/i,
    preferredCandidatePattern: /\byt[-\s]?dlp\b/i,
  },
  {
    id: "transcription",
    label: "Local transcription",
    reason: "Transcribe the requested speech locally without sending the media to a hosted transcription service.",
    query: "Whisper local speech to text transcription subtitles audio video open source",
    matches: (task) => /\b(whisper|transcrib(?:e|es|ed|ing)|transcript(?:ion)?|speech[-\s]?to[-\s]?text)\b/i.test(task),
    candidatePattern: /\b(whisper|transcrib|transcript|speech.?to.?text|subtitles?)\b/i,
    preferredCandidatePattern: /\bwhisper\b/i,
  },
  {
    id: "analytics",
    label: "Web analytics",
    reason: "Connect and read the privacy-aware website analytics needed by the task.",
    query: "Plausible privacy cookie free website analytics visitors conversions self hosted",
    matches: (task) => /\b(plausible|web(?:site)?\s+analytics|traffic\s+analytics|cookie[-\s]?free\s+analytics|visitors?\s+(?:and\s+)?conversions?)\b/i.test(task),
    candidatePattern: /\b(plausible|web(?:site)?\s+analytics|privacy\s+analytics|cookie[-\s]?free)\b/i,
    preferredCandidatePattern: /\bplausible\b/i,
  },
  {
    id: "knowledge-workspace",
    label: "Knowledge workspace",
    reason: "Use the requested open workspace for documents, wikis, and project boards.",
    query: "AppFlowy open source Notion alternative docs wiki project boards self hosted",
    matches: (task) => /\b(appflowy|notion\s+alternative|docs?\s+(?:and|with)\s+wiki|project\s+boards?)\b/i.test(task),
    candidatePattern: /\b(appflowy|notion\s+alternative|knowledge\s+workspace|docs?\s+(?:and|with)\s+wiki|project\s+boards?)\b/i,
    preferredCandidatePattern: /\bappflowy\b/i,
  },
  {
    id: "workflow-automation",
    label: "Workflow automation",
    reason: "Build or run the requested integration workflow, webhook, schedule, or AI-node automation.",
    query: "n8n workflow automation integrations AI nodes webhooks self hosted",
    matches: (task) => /\b(n8n|workflow\s+automation|automat(?:e|es|ed|ing)\s+(?:a|an|the|this)?\s*(?:workflow|process|integration)|ai\s+nodes?)\b/i.test(task),
    candidatePattern: /\b(n8n|workflow\s+automation|automation\s+service|ai\s+nodes?|webhook\s+workflow)\b/i,
    preferredCandidatePattern: /\bn8n\b/i,
  },
  {
    id: "code-mapping",
    label: "Codebase mapping",
    reason: "Map code structure and dependencies before loading targeted implementation context.",
    query: "Graphify codebase mapper dependency graph repository map reduce token context",
    matches: (task) => /\b(graphify|codebase\s+(?:map|mapper|graph)|repository\s+(?:map|graph)|dependency\s+graph|reduce\s+token\s+costs?)\b/i.test(task),
    candidatePattern: /\b(graphify|codebase\s+(?:map|mapper|graph)|repository\s+(?:map|graph)|dependency\s+graph|token\s+(?:cost|efficiency))\b/i,
    preferredCandidatePattern: /\bgraphify\b/i,
  },
  {
    id: "trading-research",
    label: "Trading research debate",
    reason: "Run a research-only team of market specialists that challenges and debates the strategy evidence.",
    query: "TradingAgents multi agent analysts researchers debate market strategy risk research only",
    matches: (task) => /\b(tradingagents|trading\s+agents|ai\s+analysts?\s+that\s+debate|debate\s+(?:a\s+)?(?:trade|trading|market|strategy))\b/i.test(task),
    candidatePattern: /\b(tradingagents|trading\s+agents|analysts?\s+debate|strategy\s+debate|market\s+analyst\s+team)\b/i,
    preferredCandidatePattern: /\btradingagents\b/i,
  },
  {
    id: "publishing-platform",
    label: "Publishing platform",
    reason: "Use an independent publishing, newsletter, membership, or subscription platform.",
    query: "Ghost open source Substack alternative publishing newsletter membership self hosted",
    matches: (task) => /\b(ghost|substack\s+alternative|open[-\s]?source\s+substack|newsletter\s+(?:and\s+)?membership\s+platform)\b/i.test(task),
    candidatePattern: /\b(ghost|substack\s+alternative|publishing\s+platform|newsletter\s+platform|membership\s+site)\b/i,
    preferredCandidatePattern: /\bghost\b/i,
  },
  {
    id: "commerce-platform",
    label: "Commerce platform",
    reason: "Use or connect the commerce platform needed for store, catalog, and product work.",
    query: "Medusa Shopify open source commerce ecommerce store catalog integration",
    matches: (task) => /\b(medusa|shopify|open[-\s]?source\s+shopify|commerce\s+(?:backend|platform)|ecommerce\s+(?:backend|platform))\b/i.test(task),
    candidatePattern: /\b(medusa|shopify|commerce\s+(?:backend|platform|connector)|ecommerce\s+(?:backend|platform)|store\s+integration)\b/i,
    preferredCandidatePattern: /\b(medusa|shopify)\b/i,
  },
  {
    id: "scheduling",
    label: "Scheduling",
    reason: "Schedule or repeat the work at the cadence requested by the task.",
    query: "Cal.com scheduling booking availability Calendly alternative scheduler automation recurring calendar reminder cron",
    matches: (task) => /\b(cal\.?(?:com)?|calendly|booking\s+link|availability|schedule|scheduled|recurring|daily|weekly|hourly|calendar|reminders?|cron|every\s+(?:day|week|hour|month|morning|evening))\b/i.test(task),
    candidatePattern: /\b(cal\.?(?:com)?|calendly|booking|availability|schedule|scheduler|automation|recurring|calendar|reminder|cron|aeon)\b/i,
    preferredCandidatePattern: /\b(cal\.?(?:com)?|scheduler|calendar|cron|aeon|n8n)\b/i,
    rejectCandidate: ({ task }, candidate) => /\b(automation[-\s]recommender|email[-\s]draft|inspiration[-\s]capture|(?:loop[-\s])?engineering[-\s]readiness)\b/i.test(candidate)
      || (recurringAutomationRequest(task)
        && /\b(cal\.?(?:com)?|calendly|booking|availability|calendar|integrations\/calcom)\b/i.test(candidate)
        && !/\b(aeon|automation|cron|n8n|scheduler)\b/i.test(candidate))
      || (!/\b(finance|financial|bank|bankr|wallet|crypto|payment|trade)\b/i.test(task) && /\bbankr\b/i.test(candidate))
      || (!/\b(gbp|google\s+business|social\s+posts?|content\s+calendar)\b/i.test(task) && /\b(local[-\s]gbp|google\s+business\s+profile|posts?[-\s]calendar)\b/i.test(candidate))
      || (!/\b(video|trailer|cinematic|briefing)\b/i.test(task) && /\bdaily[-\s]briefing[-\s]trailer\b/i.test(candidate)),
  },
];

export function requiresCapabilityApproval(task: string) {
  const value = task.trim();
  if (!value || value.includes(CAPABILITY_APPROVAL_CONTINUATION_MARKER)) return false;
  if (nonExecutingRequest(value)) return false;
  if (isConcreteHyperframesVideoRequest(value)) return false;
  if (softwareImplementationRequest(value)) return true;
  const creationAction = /\b(create|make|generate|produce|draw|render|record|install|set\s*up|connect|download|transcrib(?:e|ing)|map|deploy|host|build|develop|implement|code|repair|refactor|ship|design|prototype)\b/i.test(value)
    || /\bpublish\b[\s\S]{0,100}\b(x|twitter|social\s+post|site|website|web\s+app|application|page)\b/i.test(value);
  if (!creationAction) return false;
  return CAPABILITY_APPROVAL_INTENTS.some((intent) => intent.id !== "implementation" && intent.matches(value));
}

function stableId(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isSetupRequired(item: ContextIndexItem) {
  return item.id.startsWith("skill:packaged:optional:")
    || item.id.startsWith("skill:packaged:auto-install:")
    || item.id.startsWith("external-agent-provider:")
    || item.tags.includes("availability:setup-required");
}

function candidateLocator(item: ContextIndexItem) {
  return item.route || item.path || item.load.target || undefined;
}

function publicMachineName(value?: string) {
  const redacted = value?.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "").replace(/\s+/g, " ").trim();
  return redacted || undefined;
}

function toCandidate(item: ContextIndexItem): CapabilityCandidate {
  const githubCapability = githubCapabilityForContextId(item.id);
  return {
    id: item.id,
    name: item.title,
    summary: item.summary,
    kind: item.kind,
    availability: isSetupRequired(item) ? "setup-required" : "ready",
    locator: candidateLocator(item),
    machineName: publicMachineName(item.machineName),
    setupOptions: githubCapability?.setupOptions.map((option) => ({ ...option })),
  };
}

async function resolveInstalledCandidates(candidates: CapabilityCandidate[]) {
  return Promise.all(candidates.map(async (candidate) => {
    if (candidate.availability === "ready") return candidate;
    const serviceIds = candidate.setupOptions?.flatMap((option) => option.kind === "installable-service" ? [option.serviceId] : []) ?? [];
    for (const serviceId of serviceIds) {
      const status = await readInstallableServiceStatus(serviceId as Parameters<typeof readInstallableServiceStatus>[0]).catch(() => null);
      if (status?.installed) return { ...candidate, availability: "ready" as const };
    }
    return candidate;
  }));
}

function candidateImplementationKey(candidate: CapabilityCandidate) {
  const locator = candidate.locator?.trim().replace(/\/+$/, "").toLowerCase();
  return locator ? `locator:${locator}` : `id:${candidate.id}`;
}

function preferredEquivalentCandidate(current: CapabilityCandidate, candidate: CapabilityCandidate) {
  if (current.availability !== candidate.availability) {
    return candidate.availability === "ready" ? candidate : current;
  }
  if (current.kind !== candidate.kind) {
    if (candidate.kind === "hive-action") return candidate;
    if (current.kind === "hive-action") return current;
    if (current.kind === "api-route") return candidate;
    if (candidate.kind === "api-route") return current;
  }
  return current;
}

function dedupeCandidateImplementations(candidates: CapabilityCandidate[]) {
  const implementations = new Map<string, CapabilityCandidate>();
  for (const candidate of candidates) {
    const key = candidateImplementationKey(candidate);
    const current = implementations.get(key);
    implementations.set(key, current ? preferredEquivalentCandidate(current, candidate) : candidate);
  }
  return [...implementations.values()];
}

function normalizedCapabilityName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeEquivalentCandidates(items: ContextIndexItem[]) {
  const groups = new Map<string, ContextIndexItem[]>();
  for (const item of items) {
    const key = normalizedCapabilityName(item.title) || item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()].map((group) => {
    const representative = [...group].sort((left, right) => (
      Number(isSetupRequired(left)) - Number(isSetupRequired(right))
      || (right.score ?? 0) - (left.score ?? 0)
    ))[0];
    return { ...representative, score: Math.max(...group.map((item) => item.score ?? 0)) };
  });
}

const GENERIC_TASK_WORDS = new Set([
  "analyze", "app", "application", "billing", "build", "capability", "card", "checkout", "code", "cool", "create", "daily", "dashboard", "deploy", "design", "develop", "draw", "generate", "generation", "host", "hourly", "implement", "install", "interface", "make", "monthly", "pair", "payment", "payments", "produce", "prototype", "publish", "record", "refactor", "render", "repair", "report", "research", "schedule", "scheduled", "send", "service", "setup", "ship", "spreadsheet", "the", "this", "from", "use", "using", "weekly", "workflow", "write",
]);

function distinctiveTaskTokens(taskContext: string, intent: CapabilityIntent) {
  const intentWords = new Set(`${intent.label} ${intent.reason} ${intent.query}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return [...new Set(taskContext.toLowerCase().split(/[^a-z0-9]+/).filter((token) => (
    (token.length >= 4 || (token.length >= 3 && /\d/.test(token)))
    && !GENERIC_TASK_WORDS.has(token)
    && !intentWords.has(token)
  )))];
}

function candidateText(item: ContextIndexItem) {
  return `${item.id} ${item.title} ${item.summary} ${item.tags.join(" ")} ${item.aliases?.join(" ") ?? ""} ${item.retrievalText ?? ""} ${item.path ?? ""} ${item.route ?? ""}`;
}

function directCandidateText(item: ContextIndexItem) {
  return `${item.id} ${item.title} ${item.summary} ${item.tags.join(" ")} ${item.aliases?.join(" ") ?? ""}`;
}

function candidateSortScore(intent: CapabilityIntent, item: ContextIndexItem, context: CapabilityRequestContext) {
  const text = candidateText(item);
  const directText = directCandidateText(item);
  if (!intent.candidatePattern.test(directText)) return null;
  if (intent.rejectCandidate?.(context, directText, item)) return null;
  if (/\b(swarm-goal|work\s+board\s+delegat|queen\s+bee\s+orchestrat)\b/i.test(directText)) return null;
  const titleAndId = `${item.id} ${item.title}`.toLowerCase();
  const fullText = text.toLowerCase();
  const tokens = distinctiveTaskTokens(context.intentTaskContext, intent);
  const exactNameBonus = tokens.reduce((score, token) => score + (titleAndId.includes(token) ? 420 : 0), 0);
  const contextBonus = Math.min(120, tokens.reduce((score, token) => score + (fullText.includes(token) ? 24 : 0), 0));
  const primaryBonus = intent.primaryCandidatePattern?.test(titleAndId) ? 240 : 0;
  const preferredBonus = intent.preferredCandidatePattern
    ? intent.preferredCandidatePattern.test(titleAndId)
      ? 360
      : intent.preferredCandidatePattern.test(directText) ? 120 : 0
    : 0;
  return (item.score ?? 0) + 120 + primaryBonus + preferredBonus + exactNameBonus + contextBonus + (isSetupRequired(item) ? 0 : 80);
}

function rankCandidates(intent: CapabilityIntent, items: ContextIndexItem[], context: CapabilityRequestContext) {
  return dedupeEquivalentCandidates(items)
    .flatMap((item) => {
      const score = candidateSortScore(intent, item, context);
      return score === null ? [] : [{ item, score }];
    })
    .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title))
    .map((entry) => toCandidate(entry.item));
}

type CandidateSourceGroup = "fleet" | "skill" | "other";

function candidateSourceGroup(candidate: CapabilityCandidate): CandidateSourceGroup {
  if (candidate.kind === "connected-app" || candidate.kind === "app-endpoint") return "fleet";
  if (candidate.kind === "skill" || candidate.id.startsWith("skill:")) return "skill";
  return "other";
}

function boundedCandidates(intent: CapabilityIntent, candidates: CapabilityCandidate[]) {
  if (intent.id !== "video-generation") return candidates.slice(0, MAX_CANDIDATES_PER_ITEM);
  const quotas: Record<CandidateSourceGroup, number> = { fleet: 3, skill: 3, other: 2 };
  const selected = new Set<CapabilityCandidate>();
  for (const group of Object.keys(quotas) as CandidateSourceGroup[]) {
    candidates.filter((candidate) => candidateSourceGroup(candidate) === group).slice(0, quotas[group]).forEach((candidate) => selected.add(candidate));
  }
  for (const candidate of candidates) {
    if (selected.size >= MAX_CANDIDATES_PER_ITEM) break;
    selected.add(candidate);
  }
  return candidates.filter((candidate) => selected.has(candidate)).slice(0, MAX_CANDIDATES_PER_ITEM);
}

function explicitlyRequestedCapability(task: string, candidate: CapabilityCandidate) {
  const taskTokens = new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const generic = new Set(["api", "app", "capability", "connected", "generate", "generation", "generator", "media", "optional", "packaged", "runtime", "shared", "skill", "tool", "video"]);
  return `${candidate.id} ${candidate.name}`.toLowerCase().split(/[^a-z0-9]+/)
    .some((token) => (token.length >= 4 || (token.length >= 3 && /\d/.test(token))) && !generic.has(token) && taskTokens.has(token));
}

function unavailableCandidate(intent: CapabilityIntent): CapabilityCandidate {
  return {
    id: `setup:${intent.id}`,
    name: `${intent.label} capability`,
    summary: "No installed capability matched strongly enough. Approving lets the agent find and set up an appropriate implementation before continuing.",
    kind: "setup",
    availability: "setup-required",
  };
}

function builtInCandidate(intent: CapabilityIntent): CapabilityCandidate | undefined {
  if (intent.id !== "app-builder") return undefined;
  return {
    id: "hive-action:apps.build",
    name: "Create app workspace",
    summary: "Create and run a durable local app project whose files and preview stay attached to this conversation.",
    kind: "hive-action",
    availability: "ready",
    locator: "/api/app-builder",
  };
}

function selectedIntents(task: string) {
  const matched = CAPABILITY_APPROVAL_INTENTS.filter((intent) => intent.matches(task));
  const implementation = CAPABILITY_APPROVAL_INTENTS[0];
  if (!matched.length && requiresCapabilityApproval(task)) return [implementation];
  if (matched.some((intent) => intent.id === "app-builder")) {
    const hasIndependentImplementation = taskClauses(task).some((clause) => softwareImplementationRequest(clause) && !appWorkspaceRequest(clause));
    return hasIndependentImplementation ? matched : matched.filter((intent) => intent.id !== implementation.id);
  }
  if (matched.some((intent) => intent.id === implementation.id)) return matched;
  return matched;
}

function taskClauses(task: string) {
  return task.split(/\s*(?:[,;]|[.!?](?=\s|$)|\bthen\b|\band\b|\bafter\b)\s*/i).map((clause) => clause.trim()).filter(Boolean);
}

function capabilityPlanReviewMode(items: CapabilityApprovalItem[], permissionMode: ChatPermissionMode) {
  if (items.length !== 1) {
    if (!items.length || !chatPermissionModeSkipsReadyCapabilityReview(permissionMode)) return "ask" as const;
    const allSelectedCapabilitiesReady = items.every((item) => {
      const candidate = selectedCapability(item);
      return candidate?.availability === "ready" && item.decision === "use";
    });
    return allSelectedCapabilitiesReady ? "automatic" as const : "ask" as const;
  }
  const item = items[0];
  const candidate = selectedCapability(item);
  if (candidate?.availability !== "ready" || item.decision !== "use") return "ask" as const;
  // A plain "build me X" maps to the built-in conversation workspace — that IS
  // the request, so discovered alternates are steering options, never a reason
  // to stop and ask. Deploy/publish/spend keep their own downstream gates.
  if (candidate.id === "hive-action:apps.build") return "automatic" as const;
  return item.candidates.length === 1 ? "automatic" as const : "ask" as const;
}

function intentTaskContext(task: string, intent: CapabilityIntent) {
  const clauses = taskClauses(task);
  const selectedIndexes = new Set<number>();
  clauses.forEach((clause, index) => {
    if (!intent.matches(clause)) return;
    selectedIndexes.add(index);
    if (index > 0 && /\b(install|set\s*up|setup|use|using|via)\b/i.test(clauses[index - 1])) selectedIndexes.add(index - 1);
  });
  return clauses.filter((_clause, index) => selectedIndexes.has(index)).join("; ") || intent.label;
}

export async function buildCapabilityApprovalPlan(input: {
  task: string;
  agentId: string;
  agentName?: string;
  chatStorageKey: string;
  chatLeaf?: string;
  vaultPath?: string;
  origin: string;
  connectedApps?: ContextConnectedApp[];
  permissionMode?: ChatPermissionMode;
  workingDirectory?: string;
  search?: typeof searchContextIndexBatch;
  now?: number;
}): Promise<CapabilityApprovalPlan> {
  const task = input.task.trim();
  const intents = selectedIntents(task);
  const discoveredConnectedApps = input.connectedApps ?? await connectedAppsForTaskRetrieval(input.origin).catch(() => undefined);
  const connectedApps = input.connectedApps === undefined && discoveredConnectedApps
    ? applyAppPreferences(discoveredConnectedApps, await readAppPreferences().catch(() => []))
    : discoveredConnectedApps;
  const search = input.search ?? searchContextIndexBatch;
  const intentQueries = intents.map((intent) => `${intent.query}\nRequested ${intent.label}: ${intentTaskContext(task, intent)}`);
  const videoIntentIndexes = intents.flatMap((intent, index) => intent.id === "video-generation" ? [index] : []);
  const [results, videoSkillResults] = await Promise.all([
    search({
      vaultPath: input.vaultPath,
      connectedApps,
      includeRuntimeProviders: false,
      kinds: [...CAPABILITY_SEARCH_KINDS],
    }, intentQueries.map((query) => ({ query, limit: SEARCH_CANDIDATE_LIMIT }))),
    videoIntentIndexes.length
      ? search({ vaultPath: input.vaultPath, includeRuntimeProviders: false, kinds: ["skill"] }, videoIntentIndexes.map((index) => ({ query: intentQueries[index], limit: SEARCH_SKILL_CANDIDATE_LIMIT })))
      : Promise.resolve([]),
  ]);
  const videoSkillsByIntent = new Map(videoIntentIndexes.map((intentIndex, resultIndex) => [intentIndex, videoSkillResults[resultIndex]?.items ?? []]));
  const items: CapabilityApprovalItem[] = await Promise.all(intents.map(async (intent, index) => {
    const builtIn = builtInCandidate(intent);
    const ranked = rankCandidates(intent, [...(results[index]?.items ?? []), ...(videoSkillsByIntent.get(index) ?? [])], {
      task,
      intentTaskContext: intentTaskContext(task, intent),
      workingDirectory: input.workingDirectory,
    });
    const candidates = await resolveInstalledCandidates(boundedCandidates(intent, dedupeCandidateImplementations(builtIn
      ? [builtIn, ...ranked.filter((candidate) => candidate.id !== builtIn.id)]
      : ranked)));
    const availableCandidates = candidates.length ? candidates : [unavailableCandidate(intent)];
    const selected = availableCandidates.find((candidate) => explicitlyRequestedCapability(task, candidate))
      ?? availableCandidates.find((candidate) => candidate.availability === "ready")
      ?? availableCandidates[0];
    const orderedCandidates = selected === availableCandidates[0]
      ? availableCandidates
      : [selected, ...availableCandidates.filter((candidate) => candidate !== selected)];
    return {
      id: `${intent.id}-${stableId(`${task}:${intent.id}`)}`,
      intent: intent.id,
      label: intent.label,
      reason: intent.reason,
      candidates: orderedCandidates,
      selectedCapabilityId: selected.id,
      decision: selected.availability === "ready" ? "use" : "approve-setup",
    };
  }));
  const createdAt = input.now ?? Date.now();
  return {
    version: 1,
    reviewMode: capabilityPlanReviewMode(items, normalizeChatPermissionMode(input.permissionMode)),
    id: stableId(`${input.agentId}:${input.chatStorageKey}:${task}:${createdAt}`),
    task,
    agentId: input.agentId,
    agentName: input.agentName?.trim() || input.agentId,
    chatStorageKey: input.chatStorageKey,
    chatLeaf: input.chatLeaf?.trim() || `agent-${input.agentId}`,
    status: "pending",
    items,
    createdAt,
  };
}

function cleanInstruction(value: unknown, maxLength = 2_000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function normalizeDecision(value: unknown, setupRequired: boolean): CapabilityDecision {
  if (value === "remove" || value === "reject") return value;
  if (setupRequired) return value === "approve-setup" ? value : "approve-setup";
  return "use";
}

export function normalizeCapabilityApprovalPlan(value: unknown): CapabilityApprovalPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CapabilityApprovalPlan>;
  if (raw.version !== 1 || !raw.id || !raw.task || !raw.agentId || !raw.chatStorageKey || !Array.isArray(raw.items)) return null;
  const items = raw.items.flatMap((item, itemIndex) => {
    if (!item || typeof item !== "object" || !Array.isArray(item.candidates) || !item.candidates.length) return [];
    const candidates = item.candidates.filter((candidate): candidate is CapabilityCandidate => Boolean(
      candidate && typeof candidate.id === "string" && typeof candidate.name === "string" && (candidate.availability === "ready" || candidate.availability === "setup-required"),
    )).slice(0, MAX_CANDIDATES_PER_ITEM).map((candidate) => ({
      ...candidate,
      machineName: cleanInstruction(candidate.machineName, 160) || undefined,
      setupOptions: Array.isArray(candidate.setupOptions)
        ? candidate.setupOptions.reduce<CapabilitySetupOption[]>((options, option) => {
            if (!option || typeof option !== "object") return options;
            if (option.kind === "installable-service" && typeof option.serviceId === "string" && typeof option.label === "string") {
              options.push({ kind: option.kind, serviceId: cleanInstruction(option.serviceId, 100), label: cleanInstruction(option.label, 160), description: cleanInstruction(option.description, 500) });
            }
            if (option.kind === "connection" && typeof option.providerKey === "string" && typeof option.label === "string") {
              options.push({ kind: option.kind, providerKey: cleanInstruction(option.providerKey, 100), label: cleanInstruction(option.label, 160), description: cleanInstruction(option.description, 500) });
            }
            return options;
          }, [])
        : undefined,
    })) as CapabilityCandidate[];
    if (!candidates.length) return [];
    const selectedCapabilityId = candidates.some((candidate) => candidate.id === item.selectedCapabilityId)
      ? item.selectedCapabilityId
      : candidates[0].id;
    const selected = candidates.find((candidate) => candidate.id === selectedCapabilityId) ?? candidates[0];
    return [{
      id: cleanInstruction(item.id, 120) || stableId(`${raw.id}:${itemIndex}`),
      intent: cleanInstruction(item.intent, 100) || "capability",
      label: cleanInstruction(item.label, 140) || "Capability",
      reason: cleanInstruction(item.reason, 500),
      candidates,
      selectedCapabilityId,
      decision: normalizeDecision(item.decision, selected.availability === "setup-required"),
      githubUrl: cleanInstruction(item.githubUrl, 500) || undefined,
      instructions: cleanInstruction(item.instructions) || undefined,
    } satisfies CapabilityApprovalItem];
  });
  if (!items.length) return null;
  return {
    version: 1,
    reviewMode: raw.reviewMode === "automatic" ? "automatic" : "ask",
    id: cleanInstruction(raw.id, 120),
    task: cleanInstruction(raw.task, 8_000),
    agentId: cleanInstruction(raw.agentId, 200),
    agentName: cleanInstruction(raw.agentName, 200) || cleanInstruction(raw.agentId, 200),
    chatStorageKey: cleanInstruction(raw.chatStorageKey, 500),
    chatLeaf: cleanInstruction(raw.chatLeaf, 500) || `agent-${cleanInstruction(raw.agentId, 200)}`,
    status: raw.status === "approved" || raw.status === "cancelled" ? raw.status : "pending",
    items,
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : Date.now(),
    resolvedAt: Number.isFinite(raw.resolvedAt) ? Number(raw.resolvedAt) : undefined,
  };
}

export function capabilityApprovalContinuationPrompt(plan: CapabilityApprovalPlan) {
  const automatic = plan.reviewMode === "automatic";
  const included = plan.items.filter((item) => item.decision !== "remove" && item.decision !== "reject");
  const rejected = plan.items.filter((item) => item.decision === "reject");
  const omitted = plan.items.filter((item) => item.decision === "remove");
  const lines = [
    CAPABILITY_APPROVAL_CONTINUATION_MARKER,
    automatic
      ? "HivemindOS found ready capabilities automatically. Fixed infrastructure choices remain selected; when multiple viable ready options are listed, the worker model must choose from their actual task fit and runtime evidence. This does not bypass spend, secret, deploy, destructive-action, external-send, or runtime permission gates."
      : "The user approved this capability plan. Continue the original task now. Each manually selected capability is the required first implementation route for its step, not a suggestion; existing spend, secret, deploy, and destructive-action gates still apply. A fallback is allowed only after a real attempt to use the selected capability fails for a concrete, evidenced reason such as a provider rejection, missing required prerequisite, permission denial, or terminal runtime failure. Do not substitute merely because another tool is easier, and do not treat a missing convenience helper as capability failure when the selected capability still has a documented direct execution route.",
    "",
    `Original task: ${plan.task}`,
    "",
    automatic ? "Selected capability map:" : "Approved capability map:",
  ];
  for (const item of included) {
    const capability = selectedCapability(item);
    const readyOptions = automatic ? item.candidates.filter((candidate) => candidate.availability === "ready") : [];
    const modelSelects = automatic && capability?.id !== "hive-action:apps.build" && readyOptions.length > 1;
    if (modelSelects) {
      lines.push(`- ${item.label}: model-select the best ready option for the original task. Candidate order is discovery-only and is not a recommendation.`);
      lines.push(`  Capability intent: ${item.intent}`);
      lines.push("  Compare required inputs, exact task fit, confirmed readiness, configured user preferences, side-effect controls, cost policy, and output needs using only available evidence; do not invent provider quality or price claims.");
      for (const candidate of readyOptions) {
        lines.push(`  - ${candidate.name}${candidate.machineName ? ` on ${candidate.machineName}` : ""} (already available)`);
        lines.push(`    Capability id: ${candidate.id}`);
        if (candidate.locator) lines.push(`    Capability locator: ${candidate.locator}`);
        if (candidate.summary) lines.push(`    Evidence: ${candidate.summary}`);
      }
      if (item.instructions) lines.push(`  User instruction: ${item.instructions}`);
      continue;
    }
    lines.push(`- ${item.label}: ${capability?.name ?? "agent-selected capability"}${capability?.availability === "setup-required" ? " (setup/install approved)" : " (already available)"}`);
    lines.push(`  Capability intent: ${item.intent}`);
    if (capability?.id) lines.push(`  Capability id: ${capability.id}`);
    if (capability?.locator) lines.push(`  Capability locator: ${capability.locator}`);
    if (capability?.id) {
      lines.push(`  Capability execution receipt: ${!automatic && capabilityExecutionReceiptRequired(item.intent) ? "required" : "not-required"}`);
    }
    if (capability?.id.startsWith("skill:shared:")) {
      lines.push("  Shared-skill execution: this capability is the workflow at its locator, not a promise of a same-named native tool. Load its instructions and execute them through the runtime tools it documents; do not call the capability unavailable merely because no same-named tool or route appears.");
      if (!automatic && capabilityExecutionReceiptRequired(item.intent)) {
        lines.push(`  Runtime receipt: on the first real selected-capability invocation, prefix the terminal command with HIVEMINDOS_CAPABILITY_ID='${capability.id}'. Credential checks, instruction reads, and capability discovery do not count as an invocation.`);
      }
    }
    if (!automatic) {
      lines.push("  Execution contract: load and use this exact selected capability for this step before considering any substitute. If it cannot run, preserve the actual failure evidence, explain it plainly, and only then use the best viable fallback.");
    }
    if (capability?.id === "hive-action:apps.build") {
      lines.push('  Use the available invoke_hive_capability tool with surface="hive_action", operation="invoke", capabilityId="apps.build", method="POST", and App Builder request fields inside arguments. Keep all implementation inside the assigned App Builder directory and do not substitute an untracked background preview server.');
    }
    if (item.githubUrl) lines.push(`  Alternative GitHub source to inspect: ${item.githubUrl}`);
    if (item.instructions) lines.push(`  User instruction: ${item.instructions}`);
  }
  if (rejected.length) {
    lines.push("", "Capability setup rejected by the user:");
    for (const item of rejected) lines.push(`- Do not install or enable the proposed ${item.label} capability. Redesign that part using an already available route, or omit only the unsupported output if no coherent available route exists.`);
  }
  if (omitted.length) {
    lines.push("", "Capabilities and task steps removed by the user:");
    for (const item of omitted) lines.push(`- Remove the ${item.label} step entirely. Redesign the remaining task so it is coherent without that output.`);
  }
  lines.push("", "Do not ask for capability approval again for this continuation unless the redesigned task discovers a materially new capability family not listed here.");
  return lines.join("\n");
}
