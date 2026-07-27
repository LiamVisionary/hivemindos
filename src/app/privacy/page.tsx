import type { Metadata } from "next";
import Link from "next/link";

import { PrivacyDocument } from "@/features/legal/PrivacyDocument";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy · HivemindOS",
  description: "How HivemindOS keeps its core local and what happens when you choose connected services.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.shell}>
        <Link className={styles.back} href="/">← Return to HivemindOS</Link>
        <PrivacyDocument />
        <p className={styles.reviewNote}>
          This bundled copy comes from the same versioned policy source as the public HivemindOS website.
        </p>
      </div>
    </main>
  );
}
