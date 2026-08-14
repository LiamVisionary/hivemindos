export async function collectorChatRecovery(body, dependencies) {
  const requestedAgent =
    body.agent && typeof body.agent === "object" ? body.agent : {};
  const hermesHome = dependencies.expandHome(
    dependencies.sanitizeLocalDataDir(requestedAgent.localDataDir) ||
      dependencies.sanitizeLocalDataDir(body.localDataDir) ||
      dependencies.defaultHermesDir,
  );
  const message = String(body.rawUserMessage || body.message || "").trim();
  const needle = message.slice(0, 80);
  const requestedSinceMs = Number(body.sinceMs || 0);
  const sinceMs = requestedSinceMs > 0
    ? requestedSinceMs
    : dependencies.now() - 10 * 60_000;
  const sessionGroups = needle
    ? await Promise.all(
        dependencies.hermesSessionRoots(hermesHome).map(async (root) => [
          ...(await dependencies.listRecentHermesApiSessions(root, sinceMs)),
          ...(dependencies.listMatchingHermesDbSessions
            ? await dependencies.listMatchingHermesDbSessions(root, sinceMs, needle)
            : await dependencies.listRecentHermesDbSessions(root, sinceMs)),
        ]),
      )
    : [];
  const session = sessionGroups
    .flat()
    .filter((candidate) =>
      candidate.messages.some((candidateMessage) =>
        candidateMessage.role === "user" && candidateMessage.content.includes(needle),
      ),
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] ?? null;
  const active = dependencies.activeChatRunCount() > 0;
  return {
    ok: true,
    recovered: Boolean(session),
    active,
    safeToRetry: !session && !active,
    session: session
      ? {
          id: session.sessionId,
          sessionId: session.sessionId,
          runtime: "hermes",
          source: session.source || "hermes-recovery",
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
          messageCount: session.messageCount ?? session.messages.length,
        }
      : null,
  };
}
