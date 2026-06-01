import type { Metadata, Viewport } from "next";
import { BEE_ROLE_ICON_PATHS } from "@/lib/config/bee-role-icons";
import "./globals.css";

export const metadata: Metadata = {
  title: "HivemindOS",
  applicationName: "HivemindOS",
  description: "Local-first control room for HivemindOS fleets.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#080a0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: "html,body{background:#080a0f;color:#f4f7fb;}",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router has no pages/_document; keep existing Google font families without CSS @import. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap"
        />
        {BEE_ROLE_ICON_PATHS.map((href) => (
          <link key={href} rel="preload" as="image" href={href} />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
