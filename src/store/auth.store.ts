import { create } from 'zustand';
import { auth, COOKIE_AUTH_MARKER } from '@/lib/api';

interface AuthState {
  user: any;
  token: string | null;
  isAuthenticated: boolean;
  authResolved: boolean;
  login: (user: any, token: string) => void;
  clearSession: () => void;
  logout: () => void;
  loadFromStorage: () => void;
}

/**
 * ── NO JWT IN BROWSER STORAGE (security review 2026-09-01, finding 8) ───────
 *
 * `admin_token` held the raw JWT. localStorage is readable by ANY script that
 * runs on the origin, so one XSS, one compromised npm package or one hostile
 * extension took a seven-day admin session with it — and a stolen bearer token
 * is replayable from anywhere, because nothing binds it to the browser.
 *
 * The session is now the `callsim_auth` httpOnly cookie the backend already
 * set at login. Script cannot read it. What stays in localStorage is this
 * marker plus the user's display fields: enough to paint the shell on reload
 * without a round trip, and worthless to a thief. The cookie decides every
 * actual authorization, server-side.
 */
const SESSION_MARKER = COOKIE_AUTH_MARKER;

function clearStoredSession() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null, token: null, isAuthenticated: false, authResolved: false,
  login: (user, _token) => {
    // The token argument is accepted and DELIBERATELY DISCARDED — the backend
    // set an httpOnly cookie in the same response, and that is the session.
    localStorage.setItem('admin_token', SESSION_MARKER);
    localStorage.setItem('admin_user', JSON.stringify(user));
    set({ user, token: SESSION_MARKER, isAuthenticated: true, authResolved: true });
  },
  clearSession: () => {
    clearStoredSession();
    set({ user: null, token: null, isAuthenticated: false, authResolved: true });
  },
  logout: () => {
    clearStoredSession();
    set({ user: null, token: null, isAuthenticated: false, authResolved: true });
    // Fire-and-forget: clear the backend cookie. We don't block the redirect
    // on the response — if the network call fails the local state is already
    // gone and the user is leaving the page anyway.
    auth.logout().catch(() => {});
    // Hard nav so any in-flight admin.* calls are cancelled and the next page
    // load starts from a clean module graph.
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  },
  /**
   * Restore the session on reload.
   *
   * This used to decode the stored JWT and read `exp` out of it — which only
   * worked because the raw token was in localStorage, and is exactly what
   * finding 8 removed. There is no token to decode any more, and a client
   * cannot validate a session it cannot read.
   *
   * So it ASKS. The stored user paints the shell immediately (no flash of the
   * login page on every refresh), and `/api/auth/me` — which the browser sends
   * the httpOnly cookie with — is what actually decides. An expired or revoked
   * cookie fails there and the session is cleared, which is stricter than the
   * old check: it catches a session revoked server-side, which reading `exp`
   * locally never could.
   */
  /**
   * Restore the session on reload. SYNCHRONOUS, deliberately.
   *
   * ── WHY THIS DOES NOT CALL THE SERVER (measured 2026-09-01) ──────────────
   *
   * An earlier version of this awaited `/api/auth/me` and then wrote a fresh
   * `user` object into the store. `AdminShell` subscribes to the WHOLE store
   * (`useAuthStore()` with no selector), so every one of those writes
   * re-rendered the shell, which re-ran its effects, which called `/me` again.
   * Reproduced in a headless browser: every request returned 200, there were
   * no console errors, and the panel sat on "Checking admin access..." while
   * `/api/auth/me` looped forever.
   *
   * It was also redundant. `AdminShell.validateAccess` ALREADY calls `/me` and
   * checks the role server-side — that is the component that owns the gate.
   * This function's only job is to say whether a session exists locally, and
   * it can answer that without the network.
   *
   * The security property is unchanged: the cookie is still the credential,
   * the role is still verified against the server before any admin page
   * renders, and a revoked session still fails there.
   */
  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    const marker = localStorage.getItem('admin_token');
    const userStr = localStorage.getItem('admin_user');

    if (!marker || !userStr) {
      clearStoredSession();
      set({ user: null, token: null, isAuthenticated: false, authResolved: true });
      return;
    }

    try {
      const cached = JSON.parse(userStr);
      if (cached?.role !== 'ADMIN' && cached?.role !== 'SUPER_ADMIN') {
        clearStoredSession();
        set({ user: null, token: null, isAuthenticated: false, authResolved: true });
        return;
      }
      // One write, one render. `authResolved: true` immediately, so the shell
      // can run its own server-side check instead of waiting on ours.
      set({ user: cached, token: SESSION_MARKER, isAuthenticated: true, authResolved: true });
    } catch {
      clearStoredSession();
      set({ user: null, token: null, isAuthenticated: false, authResolved: true });
    }
  },
}));
