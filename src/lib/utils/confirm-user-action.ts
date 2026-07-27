"use client";

export async function confirmUserAction(message: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const result = window.confirm(message) as boolean | Promise<boolean>;
    if (typeof result === "boolean") return result;
    return await result;
  } catch {
    return confirmWithInlineDialog(message);
  }
}

function confirmWithInlineDialog(message: string): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement("div");
    const dialog = document.createElement("section");
    const title = document.createElement("h2");
    const body = document.createElement("p");
    const actions = document.createElement("div");
    const cancel = document.createElement("button");
    const confirm = document.createElement("button");

    function finish(confirmed: boolean) {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      previousFocus?.focus();
      resolve(confirmed);
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") finish(false);
      if (event.key === "Enter") finish(true);
    }

    overlay.setAttribute("role", "presentation");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      background: "rgba(3, 7, 18, 0.58)",
    });
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-user-action-title");
    Object.assign(dialog.style, {
      width: "min(420px, 100%)",
      border: "1px solid color-mix(in srgb, var(--foreground, #f8fafc) 16%, transparent)",
      borderRadius: "8px",
      boxShadow: "0 24px 80px rgba(0, 0, 0, 0.38)",
      background: "var(--panel, #10151f)",
      color: "var(--foreground, #f8fafc)",
      padding: "20px",
      fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
    });
    title.id = "confirm-user-action-title";
    title.textContent = "Confirm action";
    Object.assign(title.style, { margin: "0 0 12px", fontSize: "16px", lineHeight: "1.35" });
    body.textContent = message;
    Object.assign(body.style, { margin: "0", color: "var(--muted-foreground, #cbd5e1)", fontSize: "13px", lineHeight: "1.5", whiteSpace: "pre-wrap" });
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "18px" });
    for (const button of [cancel, confirm]) {
      button.type = "button";
      Object.assign(button.style, {
        minHeight: "36px",
        borderRadius: "7px",
        border: "1px solid color-mix(in srgb, var(--foreground, #f8fafc) 16%, transparent)",
        padding: "0 14px",
        font: "inherit",
        cursor: "pointer",
      });
    }
    cancel.textContent = "Cancel";
    Object.assign(cancel.style, { background: "transparent", color: "var(--foreground, #f8fafc)" });
    confirm.textContent = "Confirm";
    Object.assign(confirm.style, { background: "var(--danger, #dc2626)", borderColor: "var(--danger, #dc2626)", color: "#ffffff" });
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });
    document.addEventListener("keydown", handleKeydown);
    actions.append(cancel, confirm);
    dialog.append(title, body, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    confirm.focus();
  });
}
