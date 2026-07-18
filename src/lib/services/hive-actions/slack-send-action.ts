import { z } from "zod";

import { defineHiveAction } from "./define";
import { SLACK_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";

export const slackSendMessageAction = defineHiveAction({
  id: "integrations.slack-send",
  title: "Send a Slack message",
  description:
    "Post a message to Slack as the connected user (chat:write). Requires explicit confirmation. Defaults to the connected user's own DM when no channel is given. Surfaces as a capability only when Slack is connected.",
  schema: z.object({
    text: z.string().describe("The message text to post to Slack."),
    channel: z
      .string()
      .optional()
      .describe("Slack channel id (e.g. C0123ABCD) or a user id for a DM. Defaults to the connected user's own DM."),
    confirmation: z.string().optional().describe('Must be "CONFIRM_SLACK_SEND" to actually send.'),
  }),
  sideEffects: ["network", "public-message"],
  risk: "high",
  tags: ["slack", "message", "chat", "integration", "post", "notify", "send", "mcp"],
  aliases: ["slack_send_message", "post to slack", "send slack message", "message slack", "slack message", "dm on slack"],
  // Surfaced in capability search only while Slack is connected (token present).
  requiresConnection: [SLACK_TOKEN_ENV],
  confirmation: {
    token: "CONFIRM_SLACK_SEND",
    reason:
      "Posting to Slack publishes a message visible to others as the connected user; the /api/integrations/slack/send route rejects sends without CONFIRM_SLACK_SEND.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "slack_send_message" },
  contextIndex: {
    summary: "Send a Slack message as the connected user (confirmation-gated). Available only when Slack is connected.",
    retrievalText:
      "Use the slack_send_message MCP tool (or POST /api/integrations/slack/send) to post a message to Slack as the connected user via chat:write. Required: text. Optional: channel (a channel id C… the connecting user is in, or a user id for a DM; defaults to the connected user's own DM). Sends require confirmation CONFIRM_SLACK_SEND. Only available when Slack is connected (SLACK_BOT_TOKEN present).",
    route: "/api/integrations/slack/send",
    methods: ["POST"],
  },
});
