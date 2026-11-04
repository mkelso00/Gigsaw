import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Backports React's fix for an intermittent hydration failure (#418 then "reading 'parentNode'" errors)
  // into the React that Next 15.5 bundles. See scripts/react-hydration-fix.cjs; remove with Next 16.
  webpack(config) {
    config.module.rules.push({
      test: /[\\/]next[\\/]dist[\\/]compiled[\\/]react-dom(-experimental)?[\\/]cjs[\\/]react-dom-client\.(production|development)\.js$/,
      use: [path.join(__dirname, "scripts/react-hydration-fix.cjs")],
    });
    return config;
  },
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
