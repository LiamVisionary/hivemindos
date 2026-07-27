export function createSseParser(onEvent) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const block of events) {
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data) onEvent(data);
      }
    },
    flush() {
      if (!buffer.trim()) return;
      const data = buffer.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      buffer = "";
      if (data) onEvent(data);
    },
  };
}

export function runtimeEventText(payload) {
  if (!payload || payload === "[DONE]") return "";
  const event = JSON.parse(payload);
  if (event.error) throw new Error(typeof event.error === "string" ? event.error : event.error.message || "Agent request failed.");
  const delta = event.choices?.[0]?.delta?.content ?? event.delta;
  return typeof delta === "string" ? delta : "";
}
