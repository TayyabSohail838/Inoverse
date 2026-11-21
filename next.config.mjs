/** @type {import('next').NextConfig} */

// Security headers on every page and API response. They tell browsers to:
// - refuse to show Inoverse inside another site's frame (stops click-tricking),
// - load scripts, fonts and connections only from Inoverse and the services it uses,
// - never guess file types, keep the full address private when following links,
// - only use the microphone from Inoverse itself, and no camera or location.
const supabase = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js puts small inline scripts in each page; dev mode also needs eval for fast refresh.
  // blob: is for Live voice's audio processor (lib/liveVoice.js loads it with audioWorklet).
  `script-src 'self' 'unsafe-inline' blob:${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  // the browser talks to the app itself, to Supabase (sign-in), and straight to Google's
  // Live API for Live voice (with a short-lived token from /api/live)
  `connect-src 'self' wss://generativelanguage.googleapis.com${supabase ? ` ${supabase} ${supabase.replace(/^https/, "wss")}` : ""}${dev ? " ws:" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  // The API reads skills/*.md and data/*.md at runtime; make sure Vercel ships them.
  outputFileTracingIncludes: {
    "/api/**/*": ["./skills/**/*", "./data/**/*"],
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
