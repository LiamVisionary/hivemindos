export const HERMES_CLI_STREAM_EVENT_PREFIX: "__HIVEMIND_HERMES_EVENT__";

export function hermesCliFailureSummary(value: unknown): string;

export interface HermesCliStreamProtocolHandlers {
  onAssistantDelta?: (delta: string) => void;
  onAssistantReset?: (activeSegment: string) => void;
  onProcessEvent?: (event: Record<string, unknown>) => void;
}

export interface HermesCliStreamProtocol {
  push(chunk: unknown): void;
  flush(): void;
  reconcileFinal(value: unknown): void;
  snapshot(): {
    activeSegment: string;
    segmentEnded: boolean;
    sawAssistantDelta: boolean;
  };
}

export function createHermesCliStreamProtocol(
  handlers?: HermesCliStreamProtocolHandlers,
): HermesCliStreamProtocol;
