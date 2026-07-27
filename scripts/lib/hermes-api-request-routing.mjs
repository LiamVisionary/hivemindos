function cleanHeaderValue(value, maxLength = 160) {
  return String(value || "").replace(/[\r\n]/g, "").trim().slice(0, maxLength);
}

function defaultMessageContent(content) {
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content : String(content ?? "");
}

export function hermesApiMessages(body, text, normalizeContent = defaultMessageContent) {
  if (Array.isArray(body?.messages) && body.messages.length > 0) {
    return body.messages
      .filter((message) => message && typeof message === "object")
      .map((message) => ({
        role:
          message.role === "assistant" || message.role === "system"
            ? message.role
            : "user",
        content: normalizeContent(message.content),
      }))
      .filter((message) =>
        Array.isArray(message.content)
          ? message.content.length > 0
          : String(message.content).trim(),
      );
  }
  return [{ role: "user", content: text }];
}

export function hermesApiSessionHeaders(body, options = {}) {
  if (options.authenticated === false) return {};
  const headers = {};
  const sessionId = cleanHeaderValue(body?.hermesSessionId);
  const sessionKey = cleanHeaderValue(body?.sessionKey || body?.runtimeSessionId);
  if (sessionId) headers["X-Hermes-Session-Id"] = sessionId;
  if (sessionKey) headers["X-Hermes-Session-Key"] = sessionKey;
  return headers;
}

export function hermesSessionIdFromResponse(headers) {
  if (!headers || typeof headers.get !== "function") return "";
  return cleanHeaderValue(headers.get("x-hermes-session-id"));
}

export function hermesApiSelectionMatchesAgent(agent, gatewaySelection) {
  const requestedProvider = String(agent?.provider || "").trim();
  const requestedModel = String(agent?.model || "").trim();
  if (!requestedProvider && !requestedModel) return true;

  const gatewayProvider = String(gatewaySelection?.provider || "").trim();
  const gatewayModel = String(gatewaySelection?.model || "").trim();
  if (requestedProvider && requestedProvider !== gatewayProvider) return false;
  if (requestedModel && requestedModel !== gatewayModel) return false;
  return true;
}
