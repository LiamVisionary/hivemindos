export const SWARM_GOAL_ORCHESTRATION_INSTRUCTIONS = [
  "For this task, write yourself a new goal and spawn agents in parallel — as many as needed to do it better and faster.",
  "Split the work into independent pieces, dispatch them concurrently, and synthesize the results as they return.",
  "Give each agent its own dedicated /goal.",
].join(" ");

export function parseSwarmGoalCommand(prompt: string) {
  return prompt.replace(/^\/swarm-goal\b/i, "").trim();
}

export function buildSwarmGoalPrompt(rawTask: string) {
  const task = cleanTask(rawTask);
  const specialized = specializedBuildPrompt(task);
  const buildPrompt = specialized ?? genericBuildPrompt(task);
  return `${buildPrompt.trim()}\n\n${SWARM_GOAL_ORCHESTRATION_INSTRUCTIONS}`;
}

export function swarmGoalTaskTitle(rawTask: string) {
  const task = cleanTask(rawTask);
  if (!task) return "Swarm goal";
  return `Swarm goal: ${titleCase(task).slice(0, 72)}`;
}

function cleanTask(rawTask: string) {
  return rawTask
    .replace(/^\/swarm-goal\b/i, "")
    .replace(/^(?:please\s+)?(?:build|make|create|code|implement)(?:\s+me)?\s+/i, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .trim()
    .replace(/[.?!]+$/g, "");
}

function specializedBuildPrompt(task: string) {
  if (/\broller\s*-?\s*coaster\b|\brollercoaster\b/i.test(task)) {
    return [
      "Build a first-person roller coaster POV ride in Three.js.",
      "The camera should travel along a looping track with drops, banked turns, and at least one inversion, with smooth acceleration on descents and slowing on climbs.",
      "Include track geometry, supports, a skybox, terrain below, and lighting that sells the speed. Add sound effects.",
    ].join("\n");
  }
  return null;
}

function genericBuildPrompt(task: string) {
  const thing = task || "a polished interactive experience";
  const framework = inferFramework(task);
  return [
    `Build ${articleFor(thing)}${thing} in ${framework}.`,
    `It should include ${inferFeatures(task)}, with ${inferBehavior(task)}.`,
    `Make it feel ${inferMood(task)}, using ${inferVisualDetails(task)}, ${inferEnvironmentDetails(task)}, and ${inferEffects(task)}.`,
  ].join(" ");
}

function inferFramework(task: string) {
  const text = task.toLowerCase();
  if (/\bthree\.?js\b|\bwebgl\b|\b3d\b|\bsim(?:ulator|ulation)?\b|\bpov\b|\bfirst[- ]person\b/.test(text)) return "Three.js";
  if (/\bgame\b|\bcanvas\b|\barcade\b/.test(text)) return "React, TypeScript, and Canvas";
  if (/\bdashboard\b|\bapp\b|\btool\b|\bworkflow\b|\bcrm\b|\bsaas\b/.test(text)) return "Next.js and TypeScript";
  if (/\bsite\b|\bwebsite\b|\blanding\b|\bpage\b/.test(text)) return "Next.js";
  return "Next.js and TypeScript";
}

function inferFeatures(task: string) {
  const text = task.toLowerCase();
  if (/\bsim(?:ulator|ulation)?\b|\b3d\b|\bthree\.?js\b/.test(text)) {
    return "a complete real-time scene, camera controls or guided motion, responsive HUD controls, and a clear reset/replay flow";
  }
  if (/\bdashboard\b|\bcrm\b|\bsaas\b/.test(text)) {
    return "the core dashboard views, useful controls, realistic sample data, loading and empty states, and focused verification hooks";
  }
  if (/\bgame\b|\barcade\b/.test(text)) {
    return "the main game loop, scoring, restart flow, keyboard and pointer controls, and responsive difficulty tuning";
  }
  return "the main user workflow, complete controls, responsive layout, realistic content, and useful empty/loading/error states";
}

function inferBehavior(task: string) {
  const text = task.toLowerCase();
  if (/\bsim(?:ulator|ulation)?\b|\b3d\b|\bthree\.?js\b/.test(text)) {
    return "smooth motion, tuned pacing, interactive camera or playback controls, and animation that makes the scene feel alive";
  }
  if (/\bgame\b|\barcade\b/.test(text)) {
    return "snappy input, readable feedback, polished state transitions, and satisfying moment-to-moment play";
  }
  return "clear interactions, polished transitions, keyboard-friendly flows, and behavior that works across desktop and mobile";
}

function inferMood(task: string) {
  const text = task.toLowerCase();
  if (/\bcozy\b|\bcalm\b|\bjournal\b/.test(text)) return "calm, warm, and thoughtfully crafted";
  if (/\bcyber\b|\bsci[- ]?fi\b|\bspace\b/.test(text)) return "cinematic, precise, and high-tech";
  if (/\bsim(?:ulator|ulation)?\b|\bgame\b|\bride\b/.test(text)) return "immersive, kinetic, and polished";
  return "premium, useful, and thoughtfully designed";
}

function inferVisualDetails(task: string) {
  const text = task.toLowerCase();
  if (/\bsim(?:ulator|ulation)?\b|\b3d\b|\bthree\.?js\b/.test(text)) {
    return "legible spatial composition, strong depth cues, material variation, and responsive controls";
  }
  if (/\bdashboard\b|\bcrm\b|\bsaas\b/.test(text)) {
    return "dense but scannable layout, restrained color, clear hierarchy, and crisp data surfaces";
  }
  return "clear visual hierarchy, purposeful color, high-quality typography, and polished component states";
}

function inferEnvironmentDetails(task: string) {
  const text = task.toLowerCase();
  if (/\bsim(?:ulator|ulation)?\b|\b3d\b|\bthree\.?js\b/.test(text)) return "a coherent surrounding world with scale, depth, and lighting context";
  if (/\bdashboard\b|\bapp\b|\btool\b/.test(text)) return "a production-like app shell with realistic data and practical navigation";
  return "a context-rich first screen that immediately shows the finished experience";
}

function inferEffects(task: string) {
  const text = task.toLowerCase();
  if (/\bsim(?:ulator|ulation)?\b|\b3d\b|\bthree\.?js\b|\bgame\b/.test(text)) return "motion easing, lighting changes, audio feedback where useful, and subtle performance-conscious effects";
  return "microinteractions, hover/focus states, tasteful motion, and clear feedback for important actions";
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function articleFor(value: string) {
  if (!value) return "";
  if (/^(?:a|an|the)\s/i.test(value)) return "";
  return /^[aeiou]/i.test(value.trim()) ? "an " : "a ";
}
