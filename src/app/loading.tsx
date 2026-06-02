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
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='41.569' viewBox='0 0 72 41.569'%3E%3Cg fill='none' stroke='%235eead4' stroke-opacity='.11' stroke-width='1'%3E%3Cpath d='M12 0h24l12 20.784-12 20.785H12L0 20.784z'/%3E%3Cpath d='M48-20.784h24L84 0 72 20.784H48L36 0z'/%3E%3Cpath d='M48 20.784h24l12 20.785-12 20.784H48L36 41.569z'/%3E%3C/g%3E%3C/svg%3E\"), radial-gradient(circle at 22% 18%, rgba(45, 212, 191, 0.15), transparent 25rem), radial-gradient(circle at 78% 22%, rgba(255, 212, 90, 0.12), transparent 23rem), linear-gradient(145deg, #080a0f 0%, #0d121b 50%, #111418 100%)",
        backgroundSize: "72px 41.569px, auto, auto, auto",
        color: "#f4f7fb",
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
            border: "1px solid rgba(255, 212, 90, 0.38)",
            borderRadius: 28,
            background:
              "linear-gradient(145deg, rgba(255, 212, 90, 0.16), rgba(45, 212, 191, 0.08)), rgba(5, 8, 14, 0.88)",
            boxShadow:
              "0 24px 70px rgba(0, 0, 0, 0.42), 0 0 42px rgba(45, 212, 191, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
          }}
        >
          <Image src="/icon-192.png" alt="" width={72} height={72} priority unoptimized style={{ objectFit: "contain" }} />
        </div>
        <strong style={{ fontSize: "1.32rem", fontWeight: 800, lineHeight: 1.1 }}>
          Starting HivemindOS
        </strong>
        <p style={{ maxWidth: "28ch", margin: "-6px 0 0", color: "#c6d1df", fontSize: 14, lineHeight: 1.55 }}>
          Opening the local desktop runtime...
        </p>
        <div
          aria-hidden="true"
          style={{
            width: "min(100%, 248px)",
            height: 4,
            overflow: "hidden",
            borderRadius: 999,
            background: "linear-gradient(90deg, #5eead4 0%, #ffd45a 48%, rgba(148, 163, 184, 0.18) 48%)",
          }}
        />
      </section>
    </main>
  );
}
