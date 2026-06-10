import type { CSSProperties } from "react";

import walletStyles from "@/app/wallets.module.css";
import personalStyles from "@/features/dashboard/views/PersonalWallets.module.css";
import { createStyleClass } from "@/features/dashboard/style-classes";

const walletClass = createStyleClass(walletStyles);
const personalClass = createStyleClass(personalStyles);

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Skeleton({ block = false, className = "", style }: { block?: boolean; className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={joinClasses(walletClass("walletSkeleton", block && "walletSkeletonBlock"), className)} style={style} />;
}

function WalletStatsLoading() {
  return (
    <div className={walletClass("walletTotals")} aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <span key={index}>
          <Skeleton style={{ width: 84, height: 10 }} />
          <Skeleton style={{ width: index === 1 ? 88 : 42, height: 24 }} />
        </span>
      ))}
    </div>
  );
}

function PersonalWalletCardLoading({ index }: { index: number }) {
  return (
    <article className={personalClass("personalWalletCard")} role="listitem" style={{ opacity: 1 - index * 0.08 }}>
      <header className={personalClass("personalWalletTop")}>
        <div>
          <Skeleton style={{ width: 132, height: 15 }} />
          <Skeleton style={{ width: 156, height: 11 }} />
        </div>
        <Skeleton style={{ width: 76, height: 24 }} />
      </header>
      <div className={personalClass("personalWalletBalance")}>
        <Skeleton style={{ width: 138, height: 36 }} />
        <Skeleton style={{ width: 76, height: 12 }} />
      </div>
      <div className={personalClass("personalTokenList")}>
        {Array.from({ length: 2 }, (_, tokenIndex) => (
          <div key={tokenIndex} className={personalClass("personalTokenRow")}>
            <Skeleton className={walletClass("walletSkeletonCircle")} style={{ width: 28, height: 28 }} />
            <div>
              <Skeleton style={{ width: 52, height: 12 }} />
              <Skeleton style={{ width: 118, height: 10 }} />
            </div>
            <div>
              <Skeleton style={{ width: 58, height: 12 }} />
              <Skeleton style={{ width: 44, height: 10 }} />
            </div>
          </div>
        ))}
      </div>
      <div className={personalClass("personalWalletButtons")}>
        <Skeleton block style={{ width: 88, height: 32 }} />
        <Skeleton block style={{ width: 94, height: 32 }} />
      </div>
    </article>
  );
}

function AgentWalletTileLoading({ index }: { index: number }) {
  return (
    <article className={walletClass("walletSkeletonTile")} role="listitem" style={{ opacity: 1 - index * 0.06 }}>
      <div className={walletClass("walletSkeletonTileHead")}>
        <Skeleton className={walletClass("walletSkeletonCircle")} style={{ width: 8, height: 8 }} />
        <Skeleton style={{ width: 118, height: 14 }} />
      </div>
      <div>
        <Skeleton style={{ width: 112, height: 32 }} />
        <Skeleton style={{ width: 48, height: 11, marginTop: 8 }} />
      </div>
      <div className={walletClass("walletSkeletonTileFoot")}>
        <Skeleton style={{ width: 82, height: 22 }} />
        <Skeleton className={walletClass("walletSkeletonCircle")} style={{ width: 18, height: 18 }} />
      </div>
    </article>
  );
}

function HiveRailLoading() {
  return (
    <aside className={walletClass("hiveRail")} aria-label="Loading Bankr rewards" aria-busy="true">
      <header className={walletClass("hiveRailHeader")}>
        <div>
          <Skeleton style={{ width: 94, height: 11 }} />
          <Skeleton style={{ width: 128, height: 18, marginTop: 8 }} />
        </div>
        <Skeleton className={walletClass("walletSkeletonCircle")} style={{ width: 74, height: 74, justifySelf: "end" }} />
      </header>
      <dl className={walletClass("hiveRailStats")}>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index}>
            <dt><Skeleton style={{ width: 86, height: 12 }} /></dt>
            <dd><Skeleton style={{ width: 72, height: 16 }} /></dd>
          </div>
        ))}
      </dl>
      <Skeleton block style={{ width: "100%", height: 44 }} />
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={walletClass("hiveRailDetails")}>
          <Skeleton style={{ width: index === 0 ? 160 : 118, height: 13 }} />
          <Skeleton style={{ width: "100%", height: 12, marginTop: 12 }} />
        </div>
      ))}
    </aside>
  );
}

export function WalletUsageLoading() {
  return (
    <section className={walletClass("usagePanel")} aria-label="Loading wallet usage" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Skeleton style={{ width: 122, height: 11 }} />
          <Skeleton style={{ width: 136, height: 18, marginTop: 9 }} />
        </div>
        <Skeleton block style={{ width: 96, height: 32 }} />
      </div>
      <div className={walletClass("walletUsageSkeletonGrid")}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <Skeleton style={{ width: 76, height: 10 }} />
            <Skeleton style={{ width: index === 3 ? 86 : 58, height: 24, marginTop: 10 }} />
          </div>
        ))}
      </div>
      <div className={walletClass("walletUsageSkeletonColumns")}>
        {Array.from({ length: 2 }, (_, columnIndex) => (
          <div key={columnIndex}>
            <Skeleton style={{ width: columnIndex === 0 ? 74 : 122, height: 14 }} />
            <div className={walletClass("walletUsageSkeletonRows")}>
              {Array.from({ length: 6 }, (_, rowIndex) => (
                <Skeleton key={rowIndex} block style={{ width: "100%", height: rowIndex % 2 === 0 ? 38 : 34 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function WalletPanelLoading() {
  return (
    <section className={walletClass("walletPanel", "tabPanel", "walletSkeletonPanel")} aria-label="Loading Wallets" aria-busy="true" data-hivemindos-route-loading="true">
      <div className={walletClass("walletHeader")}>
        <div>
          <Skeleton style={{ width: 112, height: 11 }} />
          <Skeleton style={{ width: 116, height: 24, marginTop: 10 }} />
          <Skeleton style={{ width: "min(420px, 72vw)", height: 13, marginTop: 12 }} />
          <Skeleton style={{ width: "min(310px, 58vw)", height: 13, marginTop: 7 }} />
        </div>
        <WalletStatsLoading />
      </div>

      <div className={walletClass("walletSegmented")} aria-hidden="true">
        <Skeleton block style={{ width: 104, height: 32 }} />
        <Skeleton block style={{ width: 104, height: 32 }} />
      </div>

      <div className={walletClass("walletWorkspace")}>
        <div className={personalClass("walletListStack")}>
          <section className={personalClass("personalWallets")} aria-label="Loading personal wallets">
            <div className={personalClass("personalWalletsHeader")}>
              <div>
                <Skeleton style={{ width: 106, height: 11 }} />
                <Skeleton style={{ width: 94, height: 18, marginTop: 8 }} />
                <Skeleton style={{ width: "min(520px, 72vw)", height: 12, marginTop: 9 }} />
              </div>
              <div className={personalClass("personalWalletActions")}>
                <Skeleton block style={{ width: 98, height: 32 }} />
                <Skeleton block style={{ width: 92, height: 32 }} />
              </div>
            </div>
            <div className={personalClass("personalWalletGrid")} role="list">
              {Array.from({ length: 2 }, (_, index) => <PersonalWalletCardLoading key={index} index={index} />)}
            </div>
          </section>

          <section className={personalClass("agentWalletsSection")} aria-label="Loading agent wallets">
            <div className={personalClass("agentWalletsHeader")}>
              <div>
                <Skeleton style={{ width: 102, height: 11 }} />
                <Skeleton style={{ width: 154, height: 18, marginTop: 8 }} />
              </div>
            </div>
            <div className={walletClass("walletGridList")} role="list">
              {Array.from({ length: 6 }, (_, index) => <AgentWalletTileLoading key={index} index={index} />)}
            </div>
          </section>
        </div>
        <HiveRailLoading />
      </div>
    </section>
  );
}
