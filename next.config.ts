import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// script-src needs 'unsafe-inline': Next streams its data in inline scripts,
// and nonces (the stricter alternative) don't work with Partial Prerendering.
// The rest still blocks framing, plugins, <base> hijacking, posting forms to
// other sites and sending data to other origins. Dev needs 'unsafe-eval' for
// React's error overlay.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // map tiles on the Fleet page
  "img-src 'self' blob: data: https://tile.openstreetmap.org",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // browsers ignore this over plain http, so it's harmless in development
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // older-browser equivalent of frame-ancestors 'none'
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // URLs contain customer IDs; don't send them to other sites
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // the dev-only indicator would cover the sidebar's collapse button
  devIndicators: { position: "bottom-right" },
  // vehicles come from Bouncie now; the old Vehicles pages are gone
  async redirects() {
    return [
      { source: "/vehicles", destination: "/fleet?tab=setup", permanent: false },
      { source: "/vehicles/:path*", destination: "/fleet?tab=setup", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    agentFeedback: true,
    // receipt uploads (photos are shrunk in the browser first); Vercel itself
    // caps a request at 4.5 MB
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
