import type { NextConfig } from "next";

// Static CSP: Next's inline bootstrap scripts need 'unsafe-inline' unless every page is rendered with a nonce.
// No third-party origin is allowed anywhere; no upgrade-insecure-requests (breaks WebKit on http://127.0.0.1 in tests).
const csp = [
  "default-src 'self'",
  // React's development build needs eval for its debugging features; production never gets it.
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  // The gateway (Caddy) compresses text; audio must keep its Content-Length and byte ranges untouched.
  compress: false,
  serverExternalPackages: ["postgres", "yauzl"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};
export default config;
