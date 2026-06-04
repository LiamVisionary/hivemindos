export type TauriUnlisten = () => void;

export function createSafeTauriUnlisten(unlisten?: TauriUnlisten): TauriUnlisten {
  let cleanedUp = false;

  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      unlisten?.();
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("Ignored stale Tauri event listener cleanup.", error);
      }
    }
  };
}

export function createSafeTauriUnlistenAll(unlisteners: TauriUnlisten[]): TauriUnlisten {
  const safeUnlisteners = unlisteners.map((unlisten) => createSafeTauriUnlisten(unlisten));
  let cleanedUp = false;

  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const unlisten of safeUnlisteners) unlisten();
  };
}
