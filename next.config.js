/** @type {import('next').NextConfig} */

// Force Node's cwd to the on-disk canonical casing BEFORE Next/Webpack starts
// resolving modules. On Windows NTFS, `cd admin` (lowercase) and `cd Admin`
// resolve to the same folder, but Webpack stores both spellings as distinct
// module identifiers — producing two copies of every Next internal in the
// graph (e.g. layout-router.js), two LayoutRouter Contexts, and the runtime
// error: "invariant expected layout router to be mounted".
const fs = require('fs');
try { process.chdir(fs.realpathSync.native(process.cwd())); } catch {}


/**
 * ── THE BUILD DIRECTORY IS OPT-IN, NOT INFERRED (2026-09-11) ────────────────
 *
 * This was `NODE_ENV === 'production' ? '.next-build' : '.next'`, which breaks
 * EVERY hosted deployment: a host runs `next build` with NODE_ENV=production
 * and then looks for `.next`, so Vercel reported
 *
 *   The Next.js output directory ".next" was not found at "/vercel/path0/.next"
 *
 * The split directory exists for one LOCAL workflow, and a good one: `next
 * build` writing into `.next` while `next dev` is serving out of it replaces
 * the chunks the dev server has already handed to the browser, so every asset
 * 404s and the app never hydrates. But that is a deliberate act by someone at a
 * terminal, not a property of production — so it is now asked for explicitly.
 *
 *   npm run build         -> .next        (what every host expects)
 *   npm run build:local   -> .next-build  (safe beside a running dev server)
 */
const distDir = process.env.NEXT_DIST_DIR || '.next';

/**
 * ── THE ADMIN PANEL HAD NO SECURITY HEADERS AT ALL ─────────────────────────
 * Security review 2026-09-01, finding 8.
 *
 * No CSP, no HSTS, no frame protection, no permissions policy — on the surface
 * that manages every trainee, reads every recording and approves every signup.
 * The trainee app already carried these; this one was simply missed.
 *
 * `connect-src` is the load-bearing directive: the panel talks to the backend
 * API and nothing else. It opens no WebSocket, so `ws:` is deliberately absent.
 *
 * 'unsafe-eval' is DEVELOPMENT ONLY, on the same measurement made for the
 * trainee app: a clean production build of that app contained zero eval or
 * new Function in its client chunks, and 227 in the dev build — webpack's
 * `devtool: 'eval'` source maps. Removing it outright breaks `next dev` and
 * nothing in production.
 *
 * 'unsafe-inline' stays for now: Next injects inline bootstrap scripts and
 * removing it needs per-request nonces. A known remaining gap, not a fix.
 */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const isProd = process.env.NODE_ENV === 'production';

const csp = [
  "default-src 'self'",
  `connect-src 'self' ${apiUrl}`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  isProd ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // The admin panel must never be framed: clickjacking here approves signups.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Two years, preloadable. Only meaningful over HTTPS, harmless otherwise.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Belt and braces with frame-ancestors, for anything that predates CSP.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  /**
   * MICROPHONE IS ALLOWED FOR THIS ORIGIN, AND ONLY THIS ORIGIN.
   *
   * The comment here used to read "the panel needs none of these; recordings
   * are played back, not captured", and `microphone=()` denies the microphone
   * to every origin INCLUDING self. But the knowledge panel ships a Record
   * button (`src/app/content/knowledge/page.tsx`) that opens `AudioRecorder`,
   * which calls `getUserMedia({ audio: true })` — so narration recording was
   * dead in the browser, and the component's own error told the admin to
   * "allow it in your browser", which could never work: the block was this
   * header, not a browser prompt. Everything else stays closed.
   */
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig = {
  reactStrictMode: true,
  distDir,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
module.exports = nextConfig;
