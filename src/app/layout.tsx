import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

// Inter matches the kit's type and holds up at 11-12px, which is where most
// of this UI lives (meta rows, tags, table figures).
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
import { OfflineProvider } from "@/components/offline-provider";
import { SyncBadge } from "@/components/sync-badge";
import { SwRegister } from "@/components/sw-register";

export const metadata: Metadata = {
  title: "Commercial OS",
  description: "Record once — update everything.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Commercial OS",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1a1a1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body
        className="min-h-dvh"
        style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}
      >
        <OfflineProvider>
          <header
            className="sticky top-0 z-10 flex items-center justify-between px-4 py-3"
            style={{
              background: "color-mix(in srgb, var(--surface-page) 88%, transparent)",
              backdropFilter: "blur(20px)",
            }}
          >
            <Link
              href="/"
              className="text-[15px] font-extrabold tracking-tight"
            >
              Commercial OS
            </Link>
            <SyncBadge />
          </header>
          <main className="mx-auto w-full max-w-lg px-4 pb-16 pt-2">
            {children}
          </main>
        </OfflineProvider>
        <SwRegister />
      </body>
    </html>
  );
}
