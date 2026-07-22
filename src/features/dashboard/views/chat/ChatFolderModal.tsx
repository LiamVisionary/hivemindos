"use client";

import type { Dispatch, ElementType, SetStateAction } from "react";
import { createPortal } from "react-dom";
import { CloseIconButton } from "@/components/ui/close-icon-button";
import type { MachineGroup } from "@/features/dashboard/dashboard-types";

type ChatFolderDraft = {
  parentPath: string;
  name: string;
  busy?: boolean;
  error?: string;
};

type ChatFolderModalProps = {
  Button: ElementType;
  chatClass: (...names: string[]) => string;
  chatFolderCreatorMachine: MachineGroup | null;
  chatFolderCreatorParentOptions: string[];
  chatFolderDraft: ChatFolderDraft;
  closeChatFolderCreator: () => void;
  createChatFolder: () => void | Promise<void>;
  fleetClass: (...names: string[]) => string;
  setChatFolderDraft: Dispatch<SetStateAction<ChatFolderDraft>>;
};

export function ChatFolderModal(props: ChatFolderModalProps) {
  const { Button, chatClass, chatFolderCreatorMachine, chatFolderCreatorParentOptions, chatFolderDraft, closeChatFolderCreator, createChatFolder, fleetClass, setChatFolderDraft } = props;
  const portalTarget = typeof document === "undefined" ? null : document.body;

  if (!portalTarget) return null;

  return createPortal((<>
      {chatFolderCreatorMachine ? (
        <div
          className={fleetClass("setupModalBackdrop")}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeChatFolderCreator();
          }}
        >
          <section className={fleetClass("setupModal", "agentSettingsModal")} role="dialog" aria-modal="true" aria-labelledby="chat-folder-title">
            <div className={fleetClass("setupModalHeader")}>
              <div>
                <p className="eyebrow">New project</p>
                <h2 id="chat-folder-title">{chatFolderCreatorMachine.name}</h2>
                <p>Create a project folder and start a fresh chat there.</p>
              </div>
              <CloseIconButton aria-label="Close" onClick={closeChatFolderCreator} />
            </div>
            <form
              className={chatClass("folderCreatorForm")}
              onSubmit={(event) => {
                event.preventDefault();
                void createChatFolder();
              }}
            >
              <label>
                <span>Location</span>
                <input
                  list="chat-folder-parent-options"
                  value={chatFolderDraft.parentPath}
                  onChange={(event) => setChatFolderDraft((current) => ({ ...current, parentPath: event.target.value, error: "" }))}
                  placeholder="~/Projects"
                />
                <datalist id="chat-folder-parent-options">
                  {chatFolderCreatorParentOptions.map((path) => (
                    <option value={path} key={path} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>Project name</span>
                <input
                  value={chatFolderDraft.name}
                  onChange={(event) => setChatFolderDraft((current) => ({ ...current, name: event.target.value, error: "" }))}
                  placeholder="new-workspace"
                  autoFocus
                />
              </label>
              {chatFolderDraft.error ? <p className={chatClass("folderCreatorError")}>{chatFolderDraft.error}</p> : null}
              <div className={fleetClass("setupModalActions")}>
                <Button type="button" variant="secondary" onClick={closeChatFolderCreator}>
                  Cancel
                </Button>
                <Button type="submit" disabled={chatFolderDraft.busy}>
                  {chatFolderDraft.busy ? "Creating..." : "Create project and open chat"}
                </Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
  </>), portalTarget);
}
