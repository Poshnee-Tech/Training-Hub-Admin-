import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Manrope, Source_Sans_3 } from 'next/font/google';
import './globals.css';
import { stripExtensionAttrs } from '@/lib/strip-extension-attrs';
import { suppressInjectedVitalsError } from '@/lib/suppress-injected-vitals-error';
import AdminShell from '@/components/layout/AdminShell';

/**
 * Brand typography: Bricolage Grotesque for display, Instrument Sans for
 * everything else. Same two faces as the agent portal — the two apps are one
 * product and a trainer moving between them should not cross a visual seam.
 *
 * Loaded through next/font rather than a Google Fonts <link>: next/font
 * self-hosts the files at build time under /_next/static, which satisfies the
 * app CSP (`font-src 'self'`). An external stylesheet link would be blocked.
 *
 * Two families, not five. The serif, the mono and the two auth faces this file
 * used to load are now aliases onto these two in globals.css, so the pages that
 * ask for them by name keep working without four more font downloads.
 */
const fontDisplay = Manrope({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const fontBody = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const fontMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Poshnee Training Hub · Admin',
  description: 'Trainer portal for Poshnee Training Hub.',
};

/** Plum, matching --plum and the navigation rail. */
export const viewport: Viewport = {
  themeColor: '#2E1B33',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      {/* suppressHydrationWarning: browser extensions (Bitdefender et al.)
          stamp attributes like bis_register onto the DOM before React
          hydrates. Covers this element's own attributes only — stamped
          descendants are handled by stripExtensionAttrs below, which clears
          them before Next's bundle hydrates. */}
      <body className="min-h-screen" suppressHydrationWarning>
        {/* The pre-paint theme bootstrap that used to sit here is gone with the
            dark/bright switch: there is one theme now, so there is no stored
            preference to read and no dark flash to prevent. */}
        {/* AdminShell owns .air-scope, so the palette and the legacy-class
            remap reach every admin page without each page opting in. */}
        {/* ── NO AUTOMATIC REFRESH (owner ruling 2026-09-11) ────────────────
            A `Revalidator` stood here. It remounted this whole routed subtree
            on a 60-second timer and on every tab focus, so a page reset itself
            while it was being read: scroll position, expanded rows and open
            panels all went. It was added on 2026-09-03 to stop pages going
            stale, and it is removed on the owner's instruction — data now
            loads when a page is opened, and not again until it is reopened.
            What that costs is recorded in KNOWN-LIMITATIONS #75. */}
        <AdminShell>{children}</AdminShell>
        <script dangerouslySetInnerHTML={{ __html: stripExtensionAttrs }} />
        {/* Same injected-reporter suppression as the agent app — matched on
            message AND stack, never on a stack that names a file. */}
        <script dangerouslySetInnerHTML={{ __html: suppressInjectedVitalsError }} />
      </body>
    </html>
  );
}
