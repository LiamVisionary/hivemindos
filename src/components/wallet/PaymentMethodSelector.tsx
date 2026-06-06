"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";
import { ArrowUpRight, Check, Coins, KeyRound, ShieldCheck } from "lucide-react";

import type { AgentPaymentProvider } from "@/lib/types/agent-wallet";
import { cn } from "@/lib/utils/cn";

import type { ProviderCopy } from "./wallet-card-types";
import walletStyles from "./AgentWalletCard.module.css";
import styles from "./PaymentMethodSelector.module.css";

export type PaymentMethodSelectorProps = {
  provider: AgentPaymentProvider;
  providerOptions: Array<[AgentPaymentProvider, ProviderCopy]>;
  providerCopy: ProviderCopy;
  onChangeProvider: (provider: AgentPaymentProvider) => void;
};

function methodIcon(value: string) {
  if (/veil/i.test(value)) return <ShieldCheck aria-hidden="true" />;
  if (/usepod/i.test(value)) return <Coins aria-hidden="true" />;
  if (/x402/i.test(value)) return <ArrowUpRight aria-hidden="true" />;
  return <KeyRound aria-hidden="true" />;
}

function methodLabel(value: string, fallback: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("veil")) return "Veil";
  if (normalized.includes("usepod")) return "UsePod";
  if (normalized.includes("x402")) return "x402";
  if (normalized.includes("claw") || normalized.includes("card")) return "Card";
  if (normalized.includes("crypto") || normalized.includes("wallet")) return "Crypto";
  if (normalized.includes("trad")) return "Trade";
  return fallback.split(/\s+/)[0];
}

function isScrollable(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  const overflowY = style.overflowY;
  return (
    (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
    element.scrollHeight > element.clientHeight
  );
}

function captureScrollState(anchor: HTMLElement) {
  const scrollContainers = new Set<HTMLElement>();
  const root = document.scrollingElement;

  if (root instanceof HTMLElement) {
    scrollContainers.add(root);
  }

  for (let element = anchor.parentElement; element; element = element.parentElement) {
    if (isScrollable(element)) {
      scrollContainers.add(element);
    }
  }

  const entries = Array.from(scrollContainers, (element) => ({
    element,
    left: element.scrollLeft,
    top: element.scrollTop,
  }));
  const windowLeft = window.scrollX;
  const windowTop = window.scrollY;

  return () => {
    for (const entry of entries) {
      entry.element.scrollTo(entry.left, entry.top);
    }
    window.scrollTo(windowLeft, windowTop);
  };
}

function scheduleScrollRestore(restoreScroll: () => void, shouldRestore: () => boolean) {
  const startedAt = window.performance.now();
  const restoreFrame = () => {
    if (!shouldRestore()) return;
    restoreScroll();
    if (window.performance.now() - startedAt < 650) {
      window.requestAnimationFrame(restoreFrame);
    }
  };

  window.requestAnimationFrame(restoreFrame);

  for (const delay of [80, 180, 360, 700]) {
    window.setTimeout(() => {
      if (shouldRestore()) {
        restoreScroll();
      }
    }, delay);
  }
}

export function PaymentMethodSelector({
  provider,
  providerOptions,
  providerCopy,
  onChangeProvider,
}: PaymentMethodSelectorProps) {
  const pendingScrollRestoreRef = useRef<null | (() => void)>(null);
  const handledPointerProviderRef = useRef<AgentPaymentProvider | null>(null);
  const scrollRestoreRunRef = useRef(0);

  const changeProvider = (anchor: HTMLElement, value: AgentPaymentProvider) => {
    if (value === provider) {
      pendingScrollRestoreRef.current = null;
      return;
    }

    const restoreScroll = pendingScrollRestoreRef.current ?? captureScrollState(anchor);
    pendingScrollRestoreRef.current = null;
    const scrollRestoreRun = scrollRestoreRunRef.current + 1;
    scrollRestoreRunRef.current = scrollRestoreRun;
    onChangeProvider(value);
    scheduleScrollRestore(restoreScroll, () => scrollRestoreRunRef.current === scrollRestoreRun);
  };

  const findProviderButton = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;

    const button = target.closest<HTMLButtonElement>("button[data-provider]");
    const value = button?.dataset.provider as AgentPaymentProvider | undefined;
    if (!button || !value || !providerOptions.some(([option]) => option === value)) return null;

    return { button, value };
  };

  const prepareProviderSelection = (event: PointerEvent<HTMLDivElement>) => {
    const hit = findProviderButton(event.target);
    if (!hit || event.button > 0) return;

    pendingScrollRestoreRef.current = hit.value === provider ? null : captureScrollState(hit.button);
    if (hit.value === provider) return;

    event.preventDefault();
    event.stopPropagation();
    handledPointerProviderRef.current = hit.value;
    changeProvider(hit.button, hit.value);
  };

  const selectProvider = (event: MouseEvent<HTMLDivElement>) => {
    const hit = findProviderButton(event.target);
    if (!hit) return;

    event.preventDefault();
    event.stopPropagation();

    if (handledPointerProviderRef.current === hit.value) {
      handledPointerProviderRef.current = null;
      return;
    }

    changeProvider(hit.button, hit.value);
  };

  return (
    <div className={cn(walletStyles.sheetField, styles.selectorField)}>
      <span className={walletStyles.fieldLabel}>Payment method</span>
      <div
        className={styles.methods}
        role="radiogroup"
        aria-label="Payment method"
        onPointerDownCapture={prepareProviderSelection}
        onClickCapture={selectProvider}
      >
        {providerOptions.map(([value, copy]) => {
          const active = value === provider;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              data-provider={value}
              title={copy.label}
              className={cn(styles.method, active && styles.methodActive)}
            >
              <span className={styles.methodIcon}>{methodIcon(value)}</span>
              <span className={styles.methodBody}><b>{methodLabel(value, copy.label)}</b></span>
              <span className={styles.methodCheck}><Check aria-hidden="true" /></span>
            </button>
          );
        })}
      </div>
      <p className={walletStyles.sheetHelp}>{providerCopy.summary}</p>
    </div>
  );
}
