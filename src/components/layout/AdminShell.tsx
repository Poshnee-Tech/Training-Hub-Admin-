'use client';

/**
 * Admin console shell — the dark chrome every admin page renders inside.
 *
 * Mounted once in the root layout, so the migration reaches all ten sections
 * without touching a single page file. Two things make that work:
 *
 *   1. This wrapper owns `.air-scope`, so the token set and the legacy remap in
 *      globals.css apply to whatever the page renders. Pages still written in
 *      the original light Tailwind classes (`card`, `text-gray-900`,
 *      `bg-gray-50`) resolve to brand colours automatically.
 *
 * Palette is the agent portal's `air-*` set — plum and amber on warm paper —
 * mirrored rather than reinvented, because the two products are one system.
 * There is one theme, so the shell no longer owns a preference or a switch.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { auth } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { token, authResolved, loadFromStorage, clearSession } = useAuthStore();
  const [accessState, setAccessState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [accessError, setAccessError] = useState('');

  const isPublic = pathname === '/login';

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  const validateAccess = useCallback(async () => {
    if (isPublic || !authResolved) return;

    if (!token) {
      router.replace('/login?reason=session-required');
      return;
    }

    setAccessState('checking');
    setAccessError('');
    try {
      const response = await auth.getMe();
      const role = response.data?.user?.role ?? response.data?.role;
      if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        clearSession();
        router.replace('/login?reason=admin-required');
        return;
      }
      setAccessState('ready');
    } catch (err: any) {
      // A 401 is handled centrally by api.ts and redirects to login. Preserve
      // other failures so a temporary backend outage does not erase a valid
      // local session or leave the console on an endless spinner.
      setAccessError(err.message || 'Could not verify your admin session.');
      setAccessState('error');
    }
  }, [authResolved, clearSession, isPublic, router, token]);

  useEffect(() => {
    validateAccess();
  }, [validateAccess]);

  let content = children;
  if (!isPublic && (!authResolved || accessState === 'checking')) {
    content = <AdminAccessLoading />;
  } else if (!isPublic && accessState === 'error') {
    content = (
      <AdminAccessError
        message={accessError}
        onRetry={validateAccess}
        onSignIn={() => {
          clearSession();
          router.replace('/login');
        }}
      />
    );
  } else if (!isPublic && accessState !== 'ready') {
    content = <AdminAccessLoading />;
  }

  return (
    <div className="air-scope relative min-h-screen bg-air-bg font-body text-air-text antialiased">
      {/* Ambient wash + switchboard grid. Decorative, built from the theme
            tokens rather than fixed colours. */}
        <div
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            background:
              'radial-gradient(720px 460px at 14% -6%, rgb(var(--air-signal) / .16), transparent 62%), radial-gradient(560px 400px at 100% 0%, rgb(var(--air-cyan) / .09), transparent 55%), radial-gradient(700px 500px at 82% 100%, rgb(var(--air-live) / .06), transparent 60%)',
          }}
          aria-hidden
        />
        <div className="air-switchgrid pointer-events-none fixed inset-0 z-0 opacity-40" aria-hidden />

        <div className="relative z-10">{content}</div>
    </div>
  );
}

function AdminAccessLoading() {
  return (
    <main className="grid min-h-screen place-items-center px-6" role="status" aria-label="Checking admin access">
      <div className="text-center">
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-air-signal border-t-transparent" />
        <p className="mt-4 text-sm font-semibold text-air-muted">Checking admin access...</p>
      </div>
    </main>
  );
}

function AdminAccessError({
  message,
  onRetry,
  onSignIn,
}: {
  message: string;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="air-panel w-full max-w-md rounded-[16px] border p-7 text-center">
        <h1 className="text-xl font-bold text-air-text">Could not verify admin access</h1>
        <p className="mt-2 text-sm leading-relaxed text-air-muted">{message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={onRetry} className="btn-primary">Try again</button>
          <button type="button" onClick={onSignIn} className="btn-secondary">Sign in again</button>
        </div>
      </section>
    </main>
  );
}
