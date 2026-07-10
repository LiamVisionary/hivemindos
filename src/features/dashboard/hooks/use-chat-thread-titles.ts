"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CHAT_THREAD_TITLE_CONFIG_STATE_KEY,
  CHAT_THREAD_TITLES_STATE_KEY,
  DEFAULT_CHAT_THREAD_TITLE_CONFIG,
  buildChatThreadTitleContext,
  parseChatThreadTitleConfig,
  parseStoredChatThreadTitles,
  sanitizeChatThreadTitle,
  type ChatThreadTitleConfig,
  type StoredChatThreadTitle,
} from "@/lib/config/chat-thread-title";
import { loadDashboardStateSnapshot, saveDashboardStateValue } from "@/lib/services/dashboard-state-client";

type ThreadTitleMessage = {
  role?: string;
  content?: string;
  surface?: string;
  processEvents?: unknown;
  attachments?: unknown;
};

const CHAT_THREAD_TITLE_CONFIG_EVENT = "hivemindos:chat-thread-title-config";

export function useChatThreadTitleConfig() {
  const [config, setConfig] = useState<ChatThreadTitleConfig>(DEFAULT_CHAT_THREAD_TITLE_CONFIG);

  useEffect(() => {
    let cancelled = false;
    void loadDashboardStateSnapshot().then((snapshot) => {
      if (cancelled) return;
      const nextConfig = parseChatThreadTitleConfig(snapshot[CHAT_THREAD_TITLE_CONFIG_STATE_KEY]);
      setConfig(nextConfig);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const syncConfig = (event: Event) => {
      const next = parseChatThreadTitleConfig((event as CustomEvent<unknown>).detail);
      setConfig(next);
    };
    window.addEventListener(CHAT_THREAD_TITLE_CONFIG_EVENT, syncConfig);
    return () => window.removeEventListener(CHAT_THREAD_TITLE_CONFIG_EVENT, syncConfig);
  }, []);

  const updateConfig = useCallback((next: ChatThreadTitleConfig) => {
    const normalized = parseChatThreadTitleConfig(next);
    setConfig(normalized);
    void saveDashboardStateValue(CHAT_THREAD_TITLE_CONFIG_STATE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(CHAT_THREAD_TITLE_CONFIG_EVENT, { detail: normalized }));
  }, []);

  return { chatThreadTitleConfig: config, updateChatThreadTitleConfig: updateConfig };
}

export function useChatThreadTitles() {
  const { chatThreadTitleConfig: config, updateChatThreadTitleConfig } = useChatThreadTitleConfig();
  const [titles, setTitles] = useState<Record<string, StoredChatThreadTitle>>({});
  const configRef = useRef(config);
  const titlesRef = useRef(titles);
  const inFlightRef = useRef(new Set<string>());

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    const syncConfigRef = (event: Event) => {
      configRef.current = parseChatThreadTitleConfig((event as CustomEvent<unknown>).detail);
    };
    window.addEventListener(CHAT_THREAD_TITLE_CONFIG_EVENT, syncConfigRef);
    return () => window.removeEventListener(CHAT_THREAD_TITLE_CONFIG_EVENT, syncConfigRef);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadDashboardStateSnapshot().then((snapshot) => {
      if (cancelled) return;
      const nextTitles = parseStoredChatThreadTitles(snapshot[CHAT_THREAD_TITLES_STATE_KEY]);
      titlesRef.current = nextTitles;
      setTitles(nextTitles);
    });
    return () => { cancelled = true; };
  }, []);

  const requestTitle = useCallback((input: { storageKey: string; messages: ThreadTitleMessage[] }) => {
    const storageKey = input.storageKey.trim();
    const activeConfig = configRef.current;
    if (!storageKey || activeConfig.mode === "off" || titlesRef.current[storageKey] || inFlightRef.current.has(storageKey)) return;
    const context = buildChatThreadTitleContext(input.messages);
    if (!context) return;
    inFlightRef.current.add(storageKey);
    void fetch("/api/chat/thread-title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: activeConfig, context }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as {
          ok?: boolean;
          title?: string;
          model?: string;
          mode?: "local" | "cloud";
        } | null;
        const title = sanitizeChatThreadTitle(data?.title);
        if (!response.ok || !data?.ok || !title || (data.mode !== "local" && data.mode !== "cloud")) return;
        const record: StoredChatThreadTitle = {
          title,
          generatedAt: Date.now(),
          mode: data.mode,
          model: String(data.model ?? "").slice(0, 240),
        };
        setTitles((current) => {
          if (current[storageKey]) return current;
          const next = { ...current, [storageKey]: record };
          titlesRef.current = next;
          void saveDashboardStateValue(CHAT_THREAD_TITLES_STATE_KEY, JSON.stringify(next));
          return next;
        });
      })
      .catch(() => undefined)
      .finally(() => inFlightRef.current.delete(storageKey));
  }, []);

  /** Rename a thread by hand. Stored with mode "manual", which also stops
   *  `requestTitle` from ever overwriting it with a generated title. */
  const setChatThreadTitle = useCallback((storageKey: string, rawTitle: string) => {
    const key = storageKey.trim();
    const title = sanitizeChatThreadTitle(rawTitle);
    if (!key) return;
    setTitles((current) => {
      const next = { ...current };
      if (title) {
        next[key] = { title, generatedAt: Date.now(), mode: "manual", model: "" };
      } else {
        delete next[key];
      }
      titlesRef.current = next;
      void saveDashboardStateValue(CHAT_THREAD_TITLES_STATE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    chatThreadTitleConfig: config,
    chatThreadTitles: titles,
    requestChatThreadTitle: requestTitle,
    setChatThreadTitle,
    updateChatThreadTitleConfig,
  };
}
