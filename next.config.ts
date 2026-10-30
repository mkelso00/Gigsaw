import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Contact imports (CSV files) are sent to a server action.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  // Only the enquiry form (/enquire/…) may be shown inside another website. Everything else can
  // only be framed by Gigsaw itself, so no other site can dress up its pages (clickjacking).
  async headers() {
    return [
      {
        source: "/((?!enquire/).*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: "/enquire/:slug*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
