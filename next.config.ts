import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Contact imports (CSV files) are sent to a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
};

export default nextConfig;
