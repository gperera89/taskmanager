import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-ical's dependency chain (@js-temporal/polyfill/jsbi) doesn't bundle cleanly
  // under Turbopack; load it via native require instead.
  serverExternalPackages: ["node-ical"],
};

export default nextConfig;
