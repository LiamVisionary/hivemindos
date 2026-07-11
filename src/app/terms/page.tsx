import type { Metadata } from "next";
import Link from "next/link";

import { TermsDocument } from "@/features/legal/TermsDocument";
import styles from "./terms.module.css";

export const metadata: Metadata = {
  title: "Terms & Conditions · HivemindOS",
  description: "Terms and conditions for using HivemindOS and HivemindOS-powered operations.",
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.shell}>
        <Link className={styles.back} href="/">← Return to HivemindOS</Link>
        <TermsDocument />
        <p className={styles.reviewNote}>
          This bundled copy comes from the same versioned policy source as the public HivemindOS website. The in-app acceptance record identifies the version you accepted.
        </p>
      </div>
    </main>
  );
}
