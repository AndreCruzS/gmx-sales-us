import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Inter matches the kit's type and holds up at 11-12px, which is where most
// of this UI lives (meta rows, tags, table figures).
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});
import { OfflineProvider } from "@/components/offline-provider";
import { NavBar } from "@/components/nav-bar";
import { SetupBanner } from "@/components/setup-banner";
import { SwRegister } from "@/components/sw-register";
import { TabBar } from "@/components/tab-bar";

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
          <SetupBanner />
          <NavBar />
          <main
            className="mx-auto w-full max-w-lg px-4 pt-2"
            style={{
              paddingBottom:
                "calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 24px)",
            }}
          >
            {children}
          </main>
          <TabBar />
        </OfflineProvider>
        <SwRegister />
      </body>
    </html>
  );
}
