"use client";

import { useState } from "react";
import { ChatInlineMarkdown } from "@/features/dashboard/ChatMarkdown";
import { Glyph, ICON } from "./primitives";
import type { ExchangeChatRow, ExchangeFolder, ExchangeMachine } from "./types";

function groupHeaderStyle(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    width: "100%",
    border: 0,
    borderRadius: 8,
    background: "transparent",
    color: "var(--fg-3)",
    cursor: "pointer",
    padding: "7px 8px",
    textAlign: "left",
  };
}

function GroupHeader({ icon, label, count, open, onToggle }: { icon: string | readonly string[]; label: string; count?: number; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={groupHeaderStyle()}
      onMouseEnter={(event) => (event.currentTarget.style.background = "var(--panel-2)")}
      onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
      aria-expanded={open}
    >
      <Glyph d={ICON.chevronR} s={12} sw={2} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms ease", color: "var(--fg-4)" }} />
      <span style={{ color: "var(--fg-3)" }}><Glyph d={icon} s={14} /></span>
      <span className="fr-eyebrow" style={{ flex: 1 }}>{label}</span>
      {count != null ? <span style={{ color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10 }}>{count}</span> : null}
    </button>
  );
}

function ChatButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="frnav-chat-btn"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      style={{ position: "absolute", right: 7, top: "50%", zIndex: 3, display: "grid", placeItems: "center", width: 24, height: 24, transform: "translateY(-50%)", border: "1px solid var(--line-2)", borderRadius: 7, background: "var(--panel-hi)", color: "var(--honey)", cursor: "pointer" }}
    >
      <Glyph d={ICON.chat} s={13} />
    </button>
  );
}

function chatSubtitle(chat: ExchangeChatRow, formatRelativeTime?: (time: number) => string) {
  return [
    chat.updatedAt && formatRelativeTime ? formatRelativeTime(chat.updatedAt) : "",
    chat.subtitle ?? "",
  ].filter(Boolean).join(" / ");
}

function RowCopy({ title, sub, active }: { title?: string; sub?: string; active?: boolean }) {
  return (
    <span style={{ display: "grid", minWidth: 0, maxWidth: "100%", flex: 1 }}>
      <span style={{ display: "block", minWidth: 0, maxWidth: "100%", overflow: "hidden", color: active ? "var(--honey)" : "var(--fg-2)", fontFamily: "var(--f-display)", fontSize: 12.5, fontWeight: 500, letterSpacing: "-0.01em", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <ChatInlineMarkdown text={title || "Previous chat"} />
      </span>
      {sub ? (
        <span style={{ display: "block", minWidth: 0, maxWidth: "100%", overflow: "hidden", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 9.5, marginTop: 2, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <ChatInlineMarkdown text={sub} />
        </span>
      ) : null}
    </span>
  );
}

function ChatRow({ chat, kind, running, onOpen, formatRelativeTime }: { chat: ExchangeChatRow; kind: "agent" | "general"; running?: boolean; onOpen: (chat: ExchangeChatRow) => void; formatRelativeTime?: (time: number) => string }) {
  const active = Boolean(chat.active);
  return (
    <div className="frnav-row">
      <button
        type="button"
        onClick={() => onOpen(chat)}
        title={[chat.title, chat.subtitle].filter(Boolean).join("\n")}
        aria-current={active ? "true" : undefined}
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden", border: 0, borderRadius: 9, background: active ? "var(--honey-soft)" : "transparent", cursor: "pointer", padding: "7px 32px 7px 13px", textAlign: "left", transition: "background 140ms ease" }}
        onMouseEnter={(event) => {
          if (!active) event.currentTarget.style.background = "var(--panel-2)";
        }}
        onMouseLeave={(event) => {
          if (!active) event.currentTarget.style.background = "transparent";
        }}
      >
        {active ? <span style={{ position: "absolute", left: -1, top: 8, bottom: 8, width: 3, borderRadius: "0 3px 3px 0", background: "var(--honey)" }} /> : null}
        {kind === "general" ? (
          <span style={{ color: active ? "var(--honey)" : "var(--fg-4)", flexShrink: 0 }}><Glyph d={ICON.chat} s={14} /></span>
        ) : (
          <span className={running ? "fr-dot live" : "fr-dot"} style={{ color: running ? "var(--live)" : "var(--fg-4)", width: 6, height: 6, flexShrink: 0 }} />
        )}
        <RowCopy title={chat.title} sub={chatSubtitle(chat, formatRelativeTime)} active={active} />
      </button>
      {kind !== "general" ? <ChatButton title="Open chat" onClick={() => onOpen(chat)} /> : null}
    </div>
  );
}

function MachineRow({ machine, open, onToggle, onStartChat }: { machine: ExchangeMachine; open: boolean; onToggle: () => void; onStartChat?: () => void }) {
  return (
    <div className="frnav-row">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden", border: 0, borderRadius: 8, background: "transparent", cursor: "pointer", padding: "7px 34px 7px 10px", textAlign: "left" }}
        onMouseEnter={(event) => (event.currentTarget.style.background = "var(--panel-2)")}
        onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
      >
        <Glyph d={ICON.chevronR} s={12} sw={2} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms ease", color: "var(--fg-4)" }} />
        <span style={{ color: "var(--fg-3)", flexShrink: 0 }}><Glyph d={ICON.server} s={14} /></span>
        <span style={{ display: "grid", minWidth: 0, maxWidth: "100%", flex: 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
            <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", color: "var(--fg)", fontFamily: "var(--f-display)", fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine.name || "Machine"}</span>
            <span className="fr-dot" style={{ color: "var(--live)", width: 5, height: 5, flexShrink: 0 }} />
          </span>
          <span style={{ display: "block", minWidth: 0, maxWidth: "100%", overflow: "hidden", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 9.5, marginTop: 2, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine.folders?.length ?? 0} folders · {machine.rosterAgentCount ?? 0} agents</span>
        </span>
      </button>
      {onStartChat ? <ChatButton title={`New chat · ${machine.name || "machine"}`} onClick={onStartChat} /> : null}
    </div>
  );
}

function FolderRows({
  folder,
  open,
  expanded,
  running,
  onOpenChat,
  onReveal,
  onStartChat,
  onToggle,
  formatRelativeTime,
}: {
  folder: ExchangeFolder;
  open: boolean;
  expanded?: boolean;
  running: (chat: ExchangeChatRow) => boolean;
  onOpenChat: (chat: ExchangeChatRow) => void;
  onReveal: (folderKey: string) => void;
  onStartChat?: () => void;
  onToggle: () => void;
  formatRelativeTime?: (time: number) => string;
}) {
  const chats = folder.chats ?? [];
  const visibleChats = expanded ? chats : chats.slice(0, 5);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div className="frnav-row">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%", width: "100%", overflow: "hidden", border: 0, borderRadius: 7, background: "transparent", cursor: "pointer", padding: "6px 32px 6px 10px", textAlign: "left" }}
          onMouseEnter={(event) => (event.currentTarget.style.background = "var(--panel-2)")}
          onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
        >
          <Glyph d={ICON.chevronR} s={11} sw={2} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms ease", color: "var(--fg-4)" }} />
          <span style={{ color: "var(--honey)", flexShrink: 0, opacity: 0.9 }}><Glyph d={open ? ICON.folderOpen : ICON.folder} s={13} /></span>
          <span style={{ minWidth: 0, flex: "1 1 auto", overflow: "hidden", color: "var(--fg-2)", fontFamily: "var(--f-mono)", fontSize: 11.5, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.label || "Folder"}</span>
        </button>
        {onStartChat ? <ChatButton title={`New chat in ${folder.label || "folder"}`} onClick={onStartChat} /> : null}
      </div>
      {open ? (
        <div style={{ display: "flex", minWidth: 0, maxWidth: "100%", flexDirection: "column", gap: 1, marginBottom: 2, marginLeft: 18, overflow: "hidden", paddingLeft: 9, borderLeft: "1px solid var(--line)" }}>
          {visibleChats.length ? visibleChats.map((chat) => (
            <ChatRow key={chat.key || chat.title} chat={chat} kind="agent" running={running(chat)} onOpen={onOpenChat} formatRelativeTime={formatRelativeTime} />
          )) : <p style={{ margin: "6px 0 6px 12px", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>No chats yet</p>}
          {!expanded && chats.length > 5 && folder.key ? (
            <button type="button" className="fr-chat-mini-button" style={{ justifySelf: "start", margin: "5px 0 3px 4px" }} onClick={() => onReveal(folder.key || "")}>
              Show {chats.length - 5} more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConversationNav({
  generalChats,
  machines,
  expandedChatFolders,
  formatRelativeTime,
  onOpenChat,
  onRevealFolder,
  running,
}: {
  generalChats: ExchangeChatRow[];
  machines: ExchangeMachine[];
  expandedChatFolders?: Set<string>;
  formatRelativeTime?: (time: number) => string;
  onOpenChat: (chat: ExchangeChatRow) => void;
  onRevealFolder: (folderKey: string) => void;
  running: (chat: ExchangeChatRow) => boolean;
}) {
  const [generalOpen, setGeneralOpen] = useState(true);
  const [machinesOpen, setMachinesOpen] = useState(true);
  const [openMachines, setOpenMachines] = useState<Record<string, boolean>>({});
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  return (
    <div className="fr-scroll" style={{ display: "grid", width: "100%", minWidth: 0, height: "100%", alignContent: "start", gap: 2, overflowX: "hidden", overflowY: "auto", padding: "12px 11px 18px" }}>
      <GroupHeader icon={ICON.chat} label="General" count={generalChats.length} open={generalOpen} onToggle={() => setGeneralOpen((open) => !open)} />
      {generalOpen ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {generalChats.length ? generalChats.map((chat) => (
            <ChatRow key={chat.key || chat.title} chat={chat} kind="general" onOpen={onOpenChat} formatRelativeTime={formatRelativeTime} />
          )) : <p style={{ margin: "8px 0 8px 12px", color: "var(--fg-4)", fontFamily: "var(--f-mono)", fontSize: 10.5 }}>No general chats yet</p>}
        </div>
      ) : null}

      <div style={{ height: 8 }} />
      <GroupHeader icon={ICON.server} label="Machines" count={machines.length} open={machinesOpen} onToggle={() => setMachinesOpen((open) => !open)} />
      {machinesOpen ? machines.map((machine) => {
        const machineKey = machine.key || machine.name || "machine";
        const machineOpen = openMachines[machineKey] ?? true;
        return (
          <div key={machineKey} style={{ display: "flex", minWidth: 0, maxWidth: "100%", flexDirection: "column", gap: 2, overflow: "hidden" }}>
            <MachineRow
              machine={machine}
              open={machineOpen}
              onToggle={() => setOpenMachines((current) => ({ ...current, [machineKey]: !machineOpen }))}
              onStartChat={machine.onStartChat}
            />
            {machineOpen ? (
              <div style={{ display: "flex", minWidth: 0, maxWidth: "100%", flexDirection: "column", gap: 1, marginBottom: 3, marginLeft: 20, marginTop: 1, overflow: "hidden", borderLeft: "1px solid var(--line)" }}>
                {(machine.folders ?? []).map((folder) => {
                  const folderKey = folder.key || folder.label || "folder";
                  const folderOpen = openFolders[folderKey] ?? true;
                  return (
                    <FolderRows
                      key={folderKey}
                      folder={folder}
                      open={folderOpen}
                      expanded={expandedChatFolders?.has(folderKey)}
                      running={running}
                      onOpenChat={onOpenChat}
                      onReveal={onRevealFolder}
                      onStartChat={folder.onStartChat}
                      onToggle={() => setOpenFolders((current) => ({ ...current, [folderKey]: !folderOpen }))}
                      formatRelativeTime={formatRelativeTime}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      }) : null}
    </div>
  );
}
