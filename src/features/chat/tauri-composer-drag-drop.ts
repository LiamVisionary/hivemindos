import { createSafeTauriUnlistenAll, type TauriUnlisten } from "@/lib/native/tauri-event-listeners";

export type TauriDropPosition = {
  x: number;
  y: number;
};

const TAURI_DRAG_ENTER_EVENT = "tauri://drag-enter";
const TAURI_DRAG_OVER_EVENT = "tauri://drag-over";
const TAURI_DRAG_DROP_EVENT = "tauri://drag-drop";
const TAURI_DRAG_LEAVE_EVENT = "tauri://drag-leave";

type TauriDragDropEventName =
  | typeof TAURI_DRAG_ENTER_EVENT
  | typeof TAURI_DRAG_OVER_EVENT
  | typeof TAURI_DRAG_DROP_EVENT
  | typeof TAURI_DRAG_LEAVE_EVENT;

export type TauriDragDropPayload =
  | { type: "enter"; paths: string[]; position: TauriDropPosition }
  | { type: "over"; position: TauriDropPosition }
  | { type: "drop"; paths: string[]; position: TauriDropPosition }
  | { type: "leave" };

export type TauriDragDropEvent = {
  payload: TauriDragDropPayload;
};

type TauriDragPathsPayload = {
  paths: string[];
  position: TauriDropPosition;
};

type TauriDragPositionPayload = {
  position: TauriDropPosition;
};

export type TauriWebviewApi = {
  getCurrentWebview: () => {
    listen: <Payload>(
      event: TauriDragDropEventName,
      handler: (event: { payload: Payload }) => void,
    ) => Promise<TauriUnlisten>;
  };
};

export async function listenForTauriComposerDragDrop(
  webviewApi: TauriWebviewApi,
  handler: (event: TauriDragDropEvent) => void,
) {
  const webview = webviewApi.getCurrentWebview();
  const unlisteners: TauriUnlisten[] = [];

  try {
    unlisteners.push(await webview.listen<TauriDragPathsPayload>(TAURI_DRAG_ENTER_EVENT, (event) => {
      handler({
        payload: {
          type: "enter",
          paths: event.payload.paths,
          position: event.payload.position,
        },
      });
    }));
    unlisteners.push(await webview.listen<TauriDragPositionPayload>(TAURI_DRAG_OVER_EVENT, (event) => {
      handler({
        payload: {
          type: "over",
          position: event.payload.position,
        },
      });
    }));
    unlisteners.push(await webview.listen<TauriDragPathsPayload>(TAURI_DRAG_DROP_EVENT, (event) => {
      handler({
        payload: {
          type: "drop",
          paths: event.payload.paths,
          position: event.payload.position,
        },
      });
    }));
    unlisteners.push(await webview.listen(TAURI_DRAG_LEAVE_EVENT, () => {
      handler({ payload: { type: "leave" } });
    }));
  } catch (error) {
    createSafeTauriUnlistenAll(unlisteners)();
    throw error;
  }

  return createSafeTauriUnlistenAll(unlisteners);
}
