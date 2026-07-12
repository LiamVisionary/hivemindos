export const QUICK_COMMANDS = Object.freeze([
  { name: "summarize", label: "Summarize", prompt: "Summarize this page in a few clear paragraphs. Call out the purpose, key points, conclusions, and anything I should notice." },
  { name: "explain", label: "Explain", prompt: "Explain the technical content on this page in simple terms. Break down key concepts and jargon, and explain any important code." },
  { name: "rewrite", label: "Rewrite", prompt: "Rewrite the selected text, or the most relevant page text if nothing is selected, to be clearer and more concise. Preserve facts, links, code, and numbers." },
  { name: "tabs", label: "Compare tabs", prompt: "Compare the active page with the other open tabs. Explain how they relate and what this browsing session suggests I am working on." },
  { name: "action-items", label: "Action items", prompt: "Extract concrete tasks, owners, deadlines, blockers, decisions, and open questions from this page. Say clearly if there are none." },
]);

export function commandForInput(value = "") {
  const match = String(value).trim().match(/^\/([a-z-]+)(?:\s+(.*))?$/i);
  if (!match) return null;
  const command = QUICK_COMMANDS.find((item) => item.name === match[1].toLowerCase());
  if (!command) return null;
  const extra = String(match[2] || "").trim();
  return { ...command, prompt: extra ? `${command.prompt}\n\nAdditional direction: ${extra}` : command.prompt };
}
