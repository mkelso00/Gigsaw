import path from "node:path";
import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  // Browsers take each file as the type it's sent as and never guess, so nothing can pass itself off as a script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites are told only which site a visitor came from, never the page: offer, contract and pay links carry tokens.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Features no page uses are turned off, for Gigsaw and anything it embeds. Location stays on for
  // Gigsaw's own pages only: acts check in with it (check-in panel, UseMyLocation).
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), serial=(), hid=(), midi=(), " +
      "accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), browsing-topics=()",
  },
  // Browsers that have seen the live site use HTTPS only, for a year. Only for production builds (`next build`
  // and `next start`), never `next dev`; browsers ignore it over plain http://localhost anyway. Subdomains are
  // left out on purpose: the domain may have other sites under it that don't all serve HTTPS.
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

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
      // Every page and file. Keys here must not repeat below: where two entries match, the later one wins.
      { source: "/:path*", headers: SECURITY_HEADERS },
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
