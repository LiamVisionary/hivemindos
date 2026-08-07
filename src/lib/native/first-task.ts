export const FIRST_TASK_EVENT = "hivemindos:start-first-task";

export const DEFAULT_FIRST_TASK_PROMPT = "What can you help me accomplish today?";

export type FirstTaskEventDetail = {
  prompt: string;
};

export function requestFirstTask(prompt = DEFAULT_FIRST_TASK_PROMPT) {
  window.dispatchEvent(new CustomEvent<FirstTaskEventDetail>(FIRST_TASK_EVENT, {
    detail: { prompt },
  }));
}
