"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { formatModelCredits } from "@/lib/utils/model-credits";
import styles from "./HivemindosModelSubscriptions.module.css";

type SubscriptionPlan = {
  tier: "plus" | "pro" | "max";
  priceUsdMonthly: number;
  monthlyCredits: number;
};

type Subscription = {
  tier?: string;
  status?: string;
  rail?: string;
  currentPeriodEnd?: string | null;
};

type SubscriptionState = {
  ok?: boolean;
  plans?: SubscriptionPlan[];
  subscriptions?: {
    desktop?: Subscription | null;
    mobile?: Subscription | null;
  };
  error?: string;
};

type Props = {
  disabled?: boolean;
  onMessage: (message: string) => void;
  openCheckout: (url: string) => Promise<"system" | "popup" | "blocked">;
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function isActive(subscription: Subscription | null | undefined) {
  return subscription?.status === "active" || subscription?.status === "trialing";
}

export function HivemindosModelSubscriptions({ disabled, onMessage, openCheckout }: Props) {
  const [state, setState] = useState<SubscriptionState>({});
  const [loading, setLoading] = useState(false);
  const [busyTier, setBusyTier] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/hivemindos/models/credits/subscription", { cache: "no-store" });
      const data = await response.json().catch(() => null) as SubscriptionState | null;
      if (!response.ok || !data?.ok) {
        setState({ ok: false, error: data?.error || `Subscription status returned HTTP ${response.status}.` });
        return;
      }
      setState(data);
    } catch (error) {
      setState({ ok: false, error: error instanceof Error ? error.message : "Could not read subscriptions." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => void refresh();
    const initialRefresh = window.setTimeout(refreshOnFocus, 0);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh]);

  const desktop = state.subscriptions?.desktop ?? null;
  const mobile = state.subscriptions?.mobile ?? null;
  const desktopActive = isActive(desktop);
  const mobileActive = isActive(mobile);
  const activeTier = mobileActive ? mobile?.tier : desktopActive ? desktop?.tier : "";

  const subscribe = useCallback(async (plan: SubscriptionPlan) => {
    if (mobileActive) {
      onMessage("This shared credit account already has an active App Store subscription. Manage it from HivemindOS mobile.");
      return;
    }
    setBusyTier(plan.tier);
    onMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/credits/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkout", tier: plan.tier }),
      });
      const data = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        checkoutUrl?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.checkoutUrl) {
        onMessage(data?.error || `Subscription checkout failed with HTTP ${response.status}.`);
        return;
      }
      const opened = await openCheckout(data.checkoutUrl);
      onMessage(opened === "blocked"
        ? "Stripe Checkout was created, but HivemindOS could not open your browser. Try the subscription button again."
        : `Opened ${plan.tier.toUpperCase()} subscription checkout. Credits will share this balance after payment.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not start the subscription checkout.");
    } finally {
      setBusyTier("");
    }
  }, [mobileActive, onMessage, openCheckout]);

  const cancel = useCallback(async () => {
    if (!desktopActive) return;
    if (!window.confirm("Cancel this HivemindOS desktop subscription? Existing credits remain available.")) return;
    setBusyTier("cancel");
    onMessage("");
    try {
      const response = await fetch("/api/hivemindos/models/credits/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await response.json().catch(() => null) as SubscriptionState | null;
      if (!response.ok || !data?.ok) {
        onMessage(data?.error || `Subscription cancellation failed with HTTP ${response.status}.`);
        return;
      }
      setState(data);
      onMessage("Subscription canceled. Existing model credits remain in the shared balance.");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not cancel the subscription.");
    } finally {
      setBusyTier("");
    }
  }, [desktopActive, onMessage]);

  return (
    <section className={styles.root} aria-label="Monthly model-credit subscription">
      <div className={styles.head}>
        <div>
          <span>Monthly subscription</span>
          <strong>Same plans and credits as HivemindOS mobile</strong>
        </div>
        {loading ? <LoaderCircle className={styles.spin} aria-label="Loading subscriptions" /> : null}
      </div>
      {state.plans?.length ? (
        <div className={styles.plans}>
          {state.plans.map((plan) => {
            const current = activeTier === plan.tier;
            const planDisabled = Boolean(disabled || busyTier || mobileActive || current);
            return (
              <button
                key={plan.tier}
                type="button"
                className={styles.plan}
                data-active={current || undefined}
                disabled={planDisabled}
                onClick={() => void subscribe(plan)}
              >
                <span>
                  <strong>{plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}</strong>
                  <small>{formatModelCredits(plan.monthlyCredits)} monthly</small>
                </span>
                <b>
                  {busyTier === plan.tier
                    ? <LoaderCircle className={styles.spin} aria-hidden="true" />
                    : current
                      ? mobileActive ? "Active · App Store" : "Active"
                      : `${formatUsd(plan.priceUsdMonthly)} / mo`}
                </b>
              </button>
            );
          })}
        </div>
      ) : loading ? null : (
        <p className={styles.warn}>{state.error || "Subscription plans are temporarily unavailable. One-time top-ups still work."}</p>
      )}
      {mobileActive ? (
        <p className={styles.hint}>Your App Store plan is already attached to this shared balance. Manage it in HivemindOS mobile.</p>
      ) : desktopActive ? (
        <div className={styles.manage}>
          <span>
            Renews {desktop?.currentPeriodEnd ? new Date(desktop.currentPeriodEnd).toLocaleDateString() : "monthly"}.
            Existing credits remain after cancellation.
          </span>
          <button type="button" disabled={Boolean(disabled || busyTier)} onClick={() => void cancel()}>
            {busyTier === "cancel" ? <LoaderCircle className={styles.spin} aria-hidden="true" /> : null}
            Cancel plan
          </button>
        </div>
      ) : null}
    </section>
  );
}
