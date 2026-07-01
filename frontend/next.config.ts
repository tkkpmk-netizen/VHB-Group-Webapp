import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow local-network browser QA (for example the in-app browser) to load
  // dev-only assets and HMR endpoints without disabling Next's origin checks.
  allowedDevOrigins: ["192.168.0.101"],
  // Pin the workspace root so Turbopack doesn't infer it from parent lockfiles.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
