#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const templatesPath = join(
  root,
  "src",
  "lib",
  "config",
  "bee-worker-souls.json",
);
const templates = JSON.parse(await readFile(templatesPath, "utf8"));

const expected = [
  "queen",
  "general",
  "planner",
  "code",
  "vision",
  "writer",
  "research",
  "artist",
  "ops",
  "qa",
  "security",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const key of expected) {
  const lines = templates[key];
  assert(
    Array.isArray(lines),
    `${key} soul template must be an array of lines.`,
  );
  assert(lines.length > 0, `${key} soul template must not be empty.`);
  assert(lines.length < 80, `${key} soul template must stay under 80 lines.`);
  assert(lines[0] === "# Soul", `${key} soul template must start with # Soul.`);
  assert(
    lines.includes("## Voice"),
    `${key} soul template must include Voice.`,
  );
  assert(
    lines.includes("## Operations"),
    `${key} soul template must include Operations.`,
  );
  assert(
    lines.includes("## Restrictions"),
    `${key} soul template must include Restrictions.`,
  );
  assert(
    lines.join("\n").includes("{{agentName}}"),
    `${key} soul template must render the agent name.`,
  );
}

const extra = Object.keys(templates).filter((key) => !expected.includes(key));
assert(
  extra.length === 0,
  `Unexpected soul template keys: ${extra.join(", ")}`,
);

const sourceFiles = [
  "src/lib/config/bee-worker-presets.ts",
  "src/features/dashboard/hooks/use-agent-controller.tsx",
  "src/features/dashboard/views/chat/AgentSettingsModal.tsx",
  "scripts/agent-telemetry-collector.mjs",
  "src/features/dashboard/hooks/use-agent-settings-controller.tsx",
];
const source = (
  await Promise.all(
    sourceFiles.map((file) => readFile(join(root, file), "utf8")),
  )
).join("\n");
assert(
  source.includes("readHermesSoul"),
  "collector must import existing Hermes SOUL.md files.",
);
assert(
  source.includes("soulTemplate: beeSoulTemplate"),
  "bee worker presets must expose the canonical soulTemplate.",
);
assert(
  source.includes("renderBeeSoulTemplate"),
  "agent create/settings flows must render class soul templates.",
);
assert(
  source.includes("currentPrompt"),
  "settings controller must preserve existing prompts when changing class.",
);

console.log(`Verified ${expected.length} bee SOUL.md templates.`);
