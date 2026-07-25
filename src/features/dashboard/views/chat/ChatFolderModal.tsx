"use client";

import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { CircleAlert, Folder, FolderOpen, FolderPlus, LoaderCircle, X } from "lucide-react";
import type { LinkedDirectory, MachineGroup } from "@/features/dashboard/dashboard-types";
import type { KanbanMachineTarget } from "@/lib/types/kanban";

import styles from "./chat-folder-modal.module.css";

type ChatFolderDraft = {
  parentPath: string;
  name: string;
  busy?: boolean;
  error?: string;
};

type ChatFolderModalProps = {
  chatFolderCreatorMachine: MachineGroup | null;
  chatFolderCreatorParentOptions: string[];
  chatFolderDraft: ChatFolderDraft;
  chooseDirectoryForMachine?: (machine: KanbanMachineTarget | null, onChoose: (directory: LinkedDirectory) => void) => void | Promise<void>;
  closeChatFolderCreator: () => void;
  createChatFolder: () => void | Promise<void>;
  setChatFolderDraft: Dispatch<SetStateAction<ChatFolderDraft>>;
};

export function ChatFolderModal(props: ChatFolderModalProps) {
  const {
    chatFolderCreatorMachine,
    chatFolderCreatorParentOptions,
    chatFolderDraft,
    chooseDirectoryForMachine,
    closeChatFolderCreator,
    createChatFolder,
    setChatFolderDraft,
  } = props;

  const open = Boolean(chatFolderCreatorMachine);
  const busy = Boolean(chatFolderDraft.busy);
  const parentPath = chatFolderDraft.parentPath;

  // A path the picker returned (or that was typed under Advanced) still has to
  // be selectable, so an unknown current value is appended. Appended rather than
  // prepended so selecting a row never reorders the list under the cursor.
  const locationOptions = useMemo(() => {
    const known = [...new Set(chatFolderCreatorParentOptions.filter(Boolean))];
    const current = parentPath.trim();
    return current && !known.includes(current) ? [...known, current] : known;
  }, [chatFolderCreatorParentOptions, parentPath]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) closeChatFolderCreator();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, closeChatFolderCreator, open]);

  const portalTarget = typeof document === "undefined" ? null : document.body;
  if (!portalTarget || !chatFolderCreatorMachine) return null;

  const machine = chatFolderCreatorMachine;
  const previewParent = parentPath.trim().replace(/\/+$/, "");
  const projectName = chatFolderDraft.name.trim();

  function selectLocation(path: string) {
    setChatFolderDraft((current) => ({ ...current, parentPath: path, error: "" }));
  }

  function browseForLocation() {
    void chooseDirectoryForMachine?.({ key: machine.key, name: machine.name, collectorUrl: machine.collectorUrl }, (directory) => {
      const path = directory.path?.trim();
      if (path) selectLocation(path);
    });
  }

  return createPortal((
    <div
      className={`fr-root ${styles.overlay}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) closeChatFolderCreator();
      }}
    >
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="chat-folder-title">
        <header className={styles.head}>
          <span className={styles.mark} aria-hidden="true"><FolderPlus size={18} /></span>
          <div className={styles.headCopy}>
            <span className={styles.eyebrow}>New project</span>
            <h2 id="chat-folder-title">{machine.name}</h2>
            <p>Create a project folder and start a fresh chat there.</p>
          </div>
          <button type="button" className={styles.close} aria-label="Close" onClick={closeChatFolderCreator} disabled={busy}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <form
          className={styles.body}
          onSubmit={(event) => {
            event.preventDefault();
            void createChatFolder();
          }}
        >
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <span className={styles.label} id="chat-folder-location-label">Location</span>
              {chooseDirectoryForMachine ? (
                <button type="button" className={styles.browse} onClick={browseForLocation} disabled={busy}>
                  <FolderOpen size={13} aria-hidden="true" /> Browse…
                </button>
              ) : null}
            </div>
            <div className={styles.locations} role="group" aria-labelledby="chat-folder-location-label">
              {locationOptions.map((path) => {
                const selected = path === parentPath.trim();
                return (
                  <button
                    key={path}
                    type="button"
                    aria-pressed={selected}
                    data-selected={selected}
                    className={styles.location}
                    onClick={() => selectLocation(path)}
                    disabled={busy}
                  >
                    <Folder size={14} aria-hidden="true" />
                    <span className={styles.locationPath}>{path}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Project name</span>
            <input
              className={styles.input}
              value={chatFolderDraft.name}
              onChange={(event) => setChatFolderDraft((current) => ({ ...current, name: event.target.value, error: "" }))}
              placeholder="new-workspace"
              disabled={busy}
              autoFocus
            />
          </label>

          <details className={styles.advanced}>
            <summary>Advanced — type a path</summary>
            <input
              className={styles.input}
              value={parentPath}
              onChange={(event) => selectLocation(event.target.value)}
              placeholder="~/Documents/code/projects"
              aria-label="Custom parent directory"
              disabled={busy}
              spellCheck={false}
            />
          </details>

          <div className={styles.preview}>
            <span className={styles.previewLabel}>Creates</span>
            <span className={styles.previewPath}>
              {previewParent}/<b>{projectName || "new-workspace"}</b>
            </span>
          </div>

          {chatFolderDraft.error ? (
            <p className={styles.error} role="alert">
              <CircleAlert size={14} aria-hidden="true" />
              {chatFolderDraft.error}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={closeChatFolderCreator} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={styles.primary} disabled={busy || !previewParent || !projectName}>
              {busy ? <LoaderCircle className={styles.spinner} size={15} aria-hidden="true" /> : <FolderPlus size={15} aria-hidden="true" />}
              {busy ? "Creating project" : "Create project and open chat"}
            </button>
          </div>
        </form>
      </section>
    </div>
  ), portalTarget);
}
