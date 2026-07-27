import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The offline sync layer talks to Supabase directly (D3/D62); nothing in
  // the Next.js request path participates in sync.
  reactStrictMode: true,
  // The IA restructure (2026-07-27) folded the module-shaped routes into the
  // rep-shaped ones. Old links and pinned PWAs keep working.
  async redirects() {
    return [
      { source: "/agenda", destination: "/", permanent: false },
      { source: "/capture", destination: "/record", permanent: false },
      { source: "/debriefs", destination: "/record", permanent: false },
      { source: "/tray", destination: "/review", permanent: false },
      { source: "/search", destination: "/accounts", permanent: false },
    ];
  },
};

export default nextConfig;
