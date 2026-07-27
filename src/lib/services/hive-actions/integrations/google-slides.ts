import { GOOGLE_REFRESH_TOKEN_ENV } from "@/lib/services/integrations/provider-connection-env";
import {
  GOOGLE_SLIDES_EDIT_CONFIRMATION,
  googleSlidesEditSchema,
  googleSlidesReadSchema,
} from "@/lib/services/integrations/google-slides";

import { defineHiveAction } from "../define";

export const googleSlidesReadAction = defineHiveAction({
  id: "integrations.google-slides-read",
  title: "Read Google Slides presentations",
  description:
    "Find Google Slides presentations, read a presentation's complete page/object model, or get a rendered page thumbnail through the connected Google account.",
  schema: googleSlidesReadSchema,
  sideEffects: ["read", "network"],
  risk: "low",
  readOnly: true,
  tags: ["google", "slides", "presentations", "decks", "read", "thumbnail", "mcp"],
  aliases: ["google_slides_read", "find google slides", "read presentation", "inspect slide deck", "slide thumbnail"],
  requiresConnection: [GOOGLE_REFRESH_TOKEN_ENV],
  mcp: { expose: true, compact: true, toolName: "google_slides_read" },
  contextIndex: {
    summary: "Find, inspect, and preview Google Slides decks through the connected Google account.",
    retrievalText:
      "Use google_slides_read after Google is connected in Integrations. action=list finds presentations by optional title search; action=get returns the complete Slides API presentation model for a presentationId; action=thumbnail returns a rendered image URL for one pageObjectId. Read a deck before editing it, and use its revisionId with google_slides_edit when concurrent changes must be rejected rather than overwritten.",
    route: "/api/integrations/google/slides",
    methods: ["POST"],
  },
});

export const googleSlidesEditAction = defineHiveAction({
  id: "integrations.google-slides-edit",
  title: "Edit Google Slides presentations",
  description:
    "Create a Google Slides presentation, replace text across selected or all pages, or apply up to 100 native Slides API batchUpdate requests. Requires explicit confirmation before every write.",
  schema: googleSlidesEditSchema,
  sideEffects: ["write", "network"],
  risk: "high",
  tags: ["google", "slides", "presentations", "decks", "edit", "create", "batch-update", "mcp"],
  aliases: ["google_slides_edit", "edit google slides", "create presentation", "update slide deck", "replace slide text"],
  requiresConnection: [GOOGLE_REFRESH_TOKEN_ENV],
  confirmation: {
    token: GOOGLE_SLIDES_EDIT_CONFIRMATION,
    reason:
      "Slides API writes can create pages, replace content, move objects, or delete presentation elements. The app route and MCP bridge both reject writes without explicit confirmation.",
    when: "always",
  },
  mcp: { expose: true, compact: true, toolName: "google_slides_edit" },
  contextIndex: {
    summary: "Create or edit Google Slides decks through confirmation-gated Slides API writes.",
    retrievalText:
      "Use google_slides_edit only after reading the target deck and receiving explicit confirmation CONFIRM_GOOGLE_SLIDES_EDIT. action=create needs title. action=replace-all-text needs presentationId plus replacements [{find,replace,matchCase?,pageObjectIds?}]. action=batch-update accepts presentationId and 1-100 native Google Slides API request objects, including createSlide, insertText, updateTextStyle, createShape, createImage, updatePageElementTransform, duplicateObject, and deleteObject. Pass requiredRevisionId from the read response when edits must fail on concurrent deck changes.",
    route: "/api/integrations/google/slides",
    methods: ["POST"],
  },
});
