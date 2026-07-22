import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
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
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <OfflineProvider>
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-[var(--background)]/95 px-4 py-3 backdrop-blur dark:border-white/10">
            <Link href="/" className="text-base font-semibold tracking-tight">
              Commercial OS
            </Link>
            <SyncBadge />
          </header>
          <main className="mx-auto w-full max-w-lg px-4 py-6">{children}</main>
        </OfflineProvider>
        <SwRegister />
      </body>
    </html>
  );
}
