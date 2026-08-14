export function createActivityWatchdog(timeoutMs, onTimeout) {
  let timer = null;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const touch = () => {
    stop();
    timer = setTimeout(onTimeout, timeoutMs);
  };
  touch();
  return { stop, touch };
}

export function startSseHeartbeat(response, label, intervalMs) {
  const timer = setInterval(() => {
    if (!response.writableEnded && !response.destroyed) response.write(`: ${label}\n\n`);
  }, intervalMs);
  return () => clearInterval(timer);
}

export async function waitForValue(load, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await load();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export function findChatSession(sessions, text, requestMarker = "") {
  if (requestMarker) {
    const markerMatch = sessions.find((session) => session.messages.some((message) => message.content.includes(requestMarker)));
    if (markerMatch) return markerMatch;
  }
  const needle = text.trim().slice(0, 80);
  return sessions.find((session) => !needle || session.messages.some((message) => message.role === "user" && message.content.includes(needle))) ?? null;
}
