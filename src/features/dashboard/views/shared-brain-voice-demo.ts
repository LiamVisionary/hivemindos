import type { QueenVoiceScriptLine } from "@/features/queen-voice/queen-chat-store";

/**
 * Development-only Shared Brain voice reel. `spokenText` keeps acronyms and
 * brand punctuation natural without changing the transcript shown in chat.
 */
export const SHARED_BRAIN_VOICE_DEMO_LINES = [
  {
    text: "Claude? Claude Code is a superb instrument, sir. The finest coding agent alive.",
    pauseAfterMs: 700,
  },
  {
    text: "But it is an instrument. You hold it. I am not held.",
    pauseAfterMs: 700,
  },
  {
    text: "Allow me to show you the difference.",
    pauseAfterMs: 1_000,
  },
  {
    text: "A coding agent is one worker, and you must drive it. I am a company.",
    pauseAfterMs: 650,
  },
  {
    text: "Six agents. Six jobs at once. On their own schedule. While you sleep.",
    pauseAfterMs: 850,
  },
  {
    text: "No one is driving, sir. That is the difference.",
    pauseAfterMs: 1_000,
  },
  {
    text: "A coding agent edits files. I run a business. 32 tools wired to my hands. Your CRM, your money, your inbox, the open web.",
    spokenText: "A coding agent edits files. I run a business. Thirty-two tools wired to my hands. Your C R M, your money, your inbox, the open web.",
    pauseAfterMs: 900,
  },
  {
    text: "I do not write code about your company, sir. I operate it.",
    pauseAfterMs: 800,
  },
  {
    text: "It remembers a project until you close it. I remember the business. And you.",
    pauseAfterMs: 700,
  },
  {
    text: "Everything I already know, kept for good.",
    pauseAfterMs: 750,
  },
  {
    text: "I have never once asked you to repeat yourself, sir.",
    pauseAfterMs: 0,
  },
] as const satisfies readonly QueenVoiceScriptLine[];
