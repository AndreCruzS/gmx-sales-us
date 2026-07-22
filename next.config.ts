import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The offline sync layer talks to Supabase directly (D3/D62); nothing in
  // the Next.js request path participates in sync.
  reactStrictMode: true,
};

export default nextConfig;
