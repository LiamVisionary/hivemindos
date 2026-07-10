import { NextRequest } from "next/server";

import { deleteRuntimeChatSessionsForThread } from "@/lib/services/chat/runtime-session-store";
import { deleteConversationNotesForThread } from "@/lib/services/obsidian/conversation-notes";
import { purgeThreadTelemetryEvents } from "@/lib/services/telemetry/local-telemetry";
import { errorJson, okJson, upstreamErrorJson } from "@/lib/utils/api-response";
import { requireAuth } from "@/lib/utils/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Erase a deleted chat thread's server-side footprint. The chat view deletes a
 * thread from durable dashboard state client-side; without this the thread's
 * telemetry outlives it — `/api/chat/thread-usage` keeps reporting its tokens
 * and cost from the runtime session files, and its rows keep surfacing from
 * the local event log via `/api/telemetry/events`.
 *
 * It also erases the thread's shared-brain mirror: the conversation notes under
 * Memory/Conversations, their Conversations Index rows, and the generated
 * Full Vault Search Index rows. Without that, agents keep recalling a chat the
 * user deleted. That purge is a HARD delete with no undo, and Syncthing
 * replicates it across the fleet — see deleteConversationNotesForThread.
 *
 * Runtime-owned usage databases (~/.hermes/state.db, ~/.openclaw/agents) are
 * NOT touched: they belong to the runtimes, not to us. Once the thread's
 * session files are gone, `readChatThreadUsage` has nothing to join those rows
 * against and reports the thread as empty.
 */
export async function DELETE(request: NextRequest) {
  const unauthorized = await requireAuth(request);
  if (unauthorized) return unauthorized;
  const chatStorageKey = request.nextUrl.searchParams.get("chatStorageKey")?.trim() ?? "";
  if (!chatStorageKey) return errorJson("A chatStorageKey query parameter is required.", 400);
  try {
    const [sessionsDeleted, eventsDeleted, conversations] = await Promise.all([
      deleteRuntimeChatSessionsForThread(chatStorageKey),
      purgeThreadTelemetryEvents(chatStorageKey),
      deleteConversationNotesForThread({ chatStorageKey }),
    ]);
    return okJson({
      chatStorageKey,
      sessionsDeleted,
      eventsDeleted,
      notesDeleted: conversations.notesDeleted,
      conversationIndexRowsRemoved: conversations.indexRowsRemoved,
      searchIndexRowsRemoved: conversations.searchIndexRowsRemoved,
      // Surfaced, not swallowed: a note the purge refused to unlink because its
      // index row pointed outside Memory/Conversations is a corrupt or hostile row.
      unsafeNotePathsSkipped: conversations.unsafeNotePathsSkipped,
    });
  } catch (error) {
    return upstreamErrorJson("Could not delete the chat thread", error);
  }
}
