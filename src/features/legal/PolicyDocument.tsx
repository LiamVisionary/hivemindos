import type { HivemindOSPolicyDocument } from "./legal-policy";
import styles from "./TermsDocument.module.css";

type PolicyDocumentProps = {
  document: HivemindOSPolicyDocument;
  compact?: boolean;
  showTitle?: boolean;
};

export function PolicyDocument({ document, compact = false, showTitle = true }: PolicyDocumentProps) {
  return (
    <article className={`${styles.document} ${compact ? styles.compact : ""}`}>
      {showTitle ? (
        <header className={styles.header}>
          <p className={styles.eyebrow}>{document.eyebrow}</p>
          <h1>{document.title}</h1>
          <p>Effective {document.effectiveDate} · Version {document.version}</p>
        </header>
      ) : null}

      {document.sections.map((section) => (
        <section className={styles.section} key={section.title}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.bullets?.length ? (
            <ul>
              {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}

