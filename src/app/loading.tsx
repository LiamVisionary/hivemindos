import Image from "next/image";

export default function Loading() {
  return (
    <main
      data-hivemindos-route-loading="true"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        background:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='41.569' viewBox='0 0 72 41.569'%3E%3Cg fill='none' stroke='%23936811' stroke-opacity='.14' stroke-width='1'%3E%3Cpath d='M12 0h24l12 20.784-12 20.785H12L0 20.784z'/%3E%3Cpath d='M48-20.784h24L84 0 72 20.784H48L36 0z'/%3E%3Cpath d='M48 20.784h24l12 20.785-12 20.784H48L36 41.569z'/%3E%3C/g%3E%3C/svg%3E\"), linear-gradient(145deg, var(--bg-0, #fcf8ee) 0%, var(--background, #f4efe4) 54%, var(--bg-1, #efe6d4) 100%)",
        backgroundSize: "72px 41.569px, auto",
        color: "var(--foreground, #221d14)",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        padding: 24,
      }}
    >
      <section
        aria-live="polite"
        aria-busy="true"
        style={{
          display: "grid",
          width: "min(100%, 360px)",
          justifyItems: "center",
          gap: 16,
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: "grid",
            width: 108,
            height: 108,
            placeItems: "center",
            border: "1px solid var(--line, rgba(137, 119, 91, 0.22))",
            borderRadius: 28,
            background: "var(--surface, rgba(251, 248, 241, 0.9))",
            boxShadow:
              "0 24px 70px rgba(82, 61, 22, 0.16), 0 0 28px rgba(185, 139, 47, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.72)",
          }}
        >
          <Image src="/icon-192.png" alt="" width={72} height={72} priority unoptimized style={{ objectFit: "contain" }} />
        </div>
        <strong style={{ fontSize: "1.32rem", fontWeight: 800, lineHeight: 1.1 }}>
          Starting HivemindOS
        </strong>
        <p style={{ maxWidth: "28ch", margin: "-6px 0 0", color: "var(--text-soft, #5e574b)", fontSize: 14, lineHeight: 1.55 }}>
          Opening the local desktop runtime...
        </p>
        <div
          aria-hidden="true"
          style={{
            width: "min(100%, 248px)",
            height: 4,
            overflow: "hidden",
            borderRadius: 999,
            background: "linear-gradient(90deg, var(--accent-strong, #936811) 0%, rgba(137, 119, 91, 0.46) 48%, rgba(137, 119, 91, 0.18) 48%)",
          }}
        />
      </section>
    </main>
  );
}
