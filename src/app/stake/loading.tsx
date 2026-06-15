import { LockKeyhole, Sparkles } from "lucide-react";
import styles from "./stake.module.css";

export default function StakeLoading() {
  return (
    <main className={styles.page} data-hivemindos-route-loading="true">
      <div className={styles.shell}>
        <section className={styles.hero} aria-busy="true" aria-live="polite">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><Sparkles aria-hidden="true" /> HIVE staking</p>
            <h1>Opening HIVE staking.</h1>
            <p>Preparing the staking view and connected Base wallet balances.</p>
          </div>
          <aside className={styles.summary} aria-label="HIVE staking loading">
            <div className={`${styles.summaryCard} ${styles.summaryCardFeature}`}>
              <span>Status</span>
              <strong><LockKeyhole aria-hidden="true" /> Loading</strong>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
