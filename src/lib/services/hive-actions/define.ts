import type { z } from "zod";
import type { HiveActionDefinition } from "./types";

const MUTATING_SIDE_EFFECTS = new Set([
  "write",
  "remote-machine",
  "wallet",
  "payment",
  "credential",
  "public-message",
]);

export function defineHiveAction<
  TSchema extends z.ZodTypeAny,
  TResult = unknown,
>(definition: HiveActionDefinition<TSchema, TResult>) {
  const id = definition.id.trim();
  if (!id) throw new Error("Hive action id is required");
  if (!definition.title.trim()) {
    throw new Error(`Hive action ${id} needs a title`);
  }
  if (!definition.description.trim()) {
    throw new Error(`Hive action ${id} needs a description`);
  }
  if (definition.tags.length === 0) {
    throw new Error(`Hive action ${id} needs at least one retrieval tag`);
  }
  if (
    definition.readOnly &&
    definition.sideEffects.some((effect) => MUTATING_SIDE_EFFECTS.has(effect))
  ) {
    throw new Error(
      `Hive action ${id} cannot be readOnly with mutating side effects`,
    );
  }
  if (
    (definition.sideEffects.includes("wallet") ||
      definition.sideEffects.includes("payment")) &&
    !definition.confirmation
  ) {
    throw new Error(
      `Hive action ${id} needs confirmation metadata for money movement`,
    );
  }
  return Object.freeze({
    ...definition,
    id,
    title: definition.title.trim(),
    description: definition.description.trim(),
    tags: Object.freeze([...definition.tags]),
    aliases: definition.aliases ? Object.freeze([...definition.aliases]) : undefined,
    sideEffects: Object.freeze([...definition.sideEffects]),
  }) as HiveActionDefinition<TSchema, TResult>;
}
