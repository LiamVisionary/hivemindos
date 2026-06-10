// Detects machine-generated chats (skill invocations, cron runs) so they can
// be excluded from human-facing chat history and shared-brain conversation
// notes. Shared by the dashboard (client) and vault writers (server).
const AUTOMATION_TRANSCRIPT_PATTERNS = [
  /\[IMPORTANT:\s*The user has invoked the "[^"]+" skill/i,
  /running as a scheduled cron job/i,
  /user has invoked the "[^"]+" skill/i,
];

export function isAutomationTranscriptText(transcript: string) {
  return AUTOMATION_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(transcript));
}
