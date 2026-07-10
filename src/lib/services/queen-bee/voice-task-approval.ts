export type QueenVoiceTaskApprovalHistoryTurn = {
  who: "you" | "queen";
  text: string;
};

export type QueenVoiceTaskApprovalRequest = {
  title?: string | null;
  message?: string | null;
};

const DIRECT_DELEGATION_PATTERN =
  /\b(?:queue|enqueue|add|put|send|submit|delegate|assign|kick\s+off|spin\s+up|start|run)\b[\s\S]{0,90}\b(?:task|work\s*board|board|kanban|hive|fleet|agent|worker|crew|job|this|that|it)\b/i;

const WORK_REQUEST_PATTERN =
  /^(?:please\s+|can you\s+|could you\s+|i need you to\s+|i want you to\s+|let'?s\s+|go ahead and\s+)?(?:review|research|build|fix|write|draft|analy[sz]e|check|investigate|diagnose|automate|schedule|remind|create|make|generate|prepare|find|summari[sz]e|audit|test|implement|update)\b/i;

const DO_WORK_REQUEST_PATTERN =
  /^(?:please\s+)?do\s+(?:a\s+|the\s+)?(?:review|audit|research|write-?up|analysis|diagnosis|fix|build|test|implementation)\b/i;

const CONFIRMATION_PATTERN =
  /^(?:yes(?:,?\s+(?:do it|do that|please|queue it|go ahead))?|yep|yeah|ok(?:ay)?|sure|confirm(?:ed)?|go ahead|do it|do that|queue it|send it|kick it off|start it|run it|please do|sounds good|let'?s do it)[.! ]*$/i;

function cleanText(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mostRecentQueenText(history: QueenVoiceTaskApprovalHistoryTurn[]) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const turn = history[i];
    if (turn?.who === "queen") {
      const text = cleanText(turn.text);
      if (text) return text;
    }
  }
  return "";
}

export function queenAskedForTaskApproval(
  history: QueenVoiceTaskApprovalHistoryTurn[],
) {
  const text = mostRecentQueenText(history);
  if (!text) return false;
  return (
    /(?:should i|want me to|say yes|say the word|approve|confirm)[\s\S]{0,180}\b(?:queue|task|work\s*board|delegate|kick\s+off|start|run|send|create)\b/i.test(
      text,
    ) ||
    /\b(?:queue|task|work\s*board|delegate|kick\s+off|start|run|send|create)\b[\s\S]{0,180}(?:should i|want me to|say yes|say the word|approve|confirm)/i.test(
      text,
    )
  );
}

export function voiceTranscriptDirectlyRequestsTask(transcript: string) {
  const text = cleanText(transcript);
  if (!text) return false;
  return (
    DIRECT_DELEGATION_PATTERN.test(text) ||
    WORK_REQUEST_PATTERN.test(text) ||
    DO_WORK_REQUEST_PATTERN.test(text)
  );
}

export function voiceTranscriptConfirmsTask(transcript: string) {
  return CONFIRMATION_PATTERN.test(cleanText(transcript));
}

export function voiceTaskSubmissionAuthorized(
  transcript: string,
  history: QueenVoiceTaskApprovalHistoryTurn[] = [],
) {
  if (voiceTranscriptDirectlyRequestsTask(transcript)) return true;
  return (
    voiceTranscriptConfirmsTask(transcript) &&
    queenAskedForTaskApproval(history)
  );
}

function taskLabel(task: QueenVoiceTaskApprovalRequest) {
  const title = cleanText(task.title);
  const message = cleanText(task.message);
  const label = title || message || "that";
  return label.length > 96 ? `${label.slice(0, 93)}...` : label;
}

export function voiceTaskApprovalPrompt(task: QueenVoiceTaskApprovalRequest) {
  return `I can queue "${taskLabel(task)}" on the Work Board. Say yes to queue it, or tell me a different direction.`;
}
