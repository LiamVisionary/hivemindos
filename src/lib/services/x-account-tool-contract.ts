export const X_ACCOUNT_READ_TOOL_NAME = "read_x_account";

export const X_ACCOUNT_READ_OPERATIONS = [
  "latest_post",
  "own_posts",
  "latest_reply_to_latest_post",
  "mentions",
  "timeline",
  "bookmarks",
  "likes",
  "search",
  "read_post",
] as const;

export type XAccountReadOperation = (typeof X_ACCOUNT_READ_OPERATIONS)[number];

export type XAccountReadToolInput = {
  operation: XAccountReadOperation;
  query?: string;
  postId?: string;
  beforePostId?: string;
  limit?: number;
};

const X_ACCOUNT_READ_OPERATION_SET = new Set<string>(X_ACCOUNT_READ_OPERATIONS);

export function coerceXAccountReadToolInput(value: unknown): XAccountReadToolInput {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const operation = typeof record.operation === "string" ? record.operation.trim() : "";
  if (!X_ACCOUNT_READ_OPERATION_SET.has(operation)) {
    throw new Error(`Unsupported X account read operation: ${operation || "missing"}.`);
  }
  return {
    operation: operation as XAccountReadOperation,
    ...(typeof record.query === "string" ? { query: record.query } : {}),
    ...(typeof record.postId === "string" ? { postId: record.postId } : {}),
    ...(typeof record.beforePostId === "string" ? { beforePostId: record.beforePostId } : {}),
    ...(Number.isFinite(Number(record.limit)) ? { limit: Number(record.limit) } : {}),
  };
}

export const X_ACCOUNT_CAPABILITY_INSTRUCTION =
  "The hive has authenticated, read-only access to the user's X account. Use read_x_account for the user's posts, replies, mentions, timeline, bookmarks, likes, post lookup, or X search; never claim X is inaccessible without trying that tool. Use latest_post only when exactly the newest post (chronology rank 1) is requested. Use own_posts for any ordinal, rank, count, comparison, history, or relative chronology request; inspect the returned ordered rows instead of inferring or repeating content from chat history. For relative follow-ups, pass beforePostId from the prior result. For capabilities not already named, use read_hivemind_context as Hive capability search before denying access.";

export const X_ACCOUNT_READ_TOOL_DEF = {
  name: X_ACCOUNT_READ_TOOL_NAME,
  description:
    "Read the connected user's X account through the official authenticated X API. Use for the user's own post history, latest original post, newest reply/comment, mentions, home timeline, bookmarks, likes, a specific post, or X search. This tool is read-only. Call it instead of saying you cannot access X or inferring a post from chat history.",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        enum: X_ACCOUNT_READ_OPERATIONS,
        description:
          "The read operation. latest_post means exactly chronology rank 1. Use own_posts whenever the request involves another rank, an ordinal, multiple posts, comparison, history, or an older/newer relationship.",
      },
      query: {
        type: "string",
        description: "Required for search. Use normal X search syntax when useful.",
      },
      postId: {
        type: "string",
        description: "Required for read_post. Accepts a numeric post id or canonical x.com post URL.",
      },
      beforePostId: {
        type: "string",
        description:
          "Optional for own_posts. Return the user's posts older than this numeric post id or canonical x.com post URL. Use the post returned in the previous turn as the anchor for relative follow-ups.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
        description:
          "Requested rows for list/search reads. Defaults to 10; values below X's API minimum are raised to 5 for mentions and 10 for search.",
      },
    },
    required: ["operation"],
    additionalProperties: false,
  },
} as const;

export const X_ACCOUNT_READ_CHAT_TOOL = {
  type: "function" as const,
  function: X_ACCOUNT_READ_TOOL_DEF,
};
