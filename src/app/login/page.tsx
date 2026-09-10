'use client';

import { useState } from 'react';
import { auth } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Admin sign-in — the Poshnee Training Hub switchboard.
 *
 * Dark patch panel with ambient jacks on either side of the card. Visuals and
 * animations come from the design's scoped <style> below; the connect flow is
 * real (auth.login), not the demo's fake timer. The entrance fade-up lives on
 * .card-wrap so the card's own inline tilt transform never fights the entry
 * animation.
 *
 * Motes are rendered from fixed constants rather than Math.random so the
 * server-rendered HTML and the client hydration pass produce the same DOM.
 */

// Fixed motes so SSR and hydration render identical DOM (no Math.random).
// Order: left (vw), duration, delay — all in seconds / vw units.
const MOTES: ReadonlyArray<[string, string, string]> = [
  ['6', '9s', '0s'], ['13', '12s', '1.2s'], ['21', '10.5s', '2.6s'],
  ['29', '13s', '0.8s'], ['37', '9.5s', '3.4s'], ['44', '11.5s', '1.8s'],
  ['52', '10s', '0.4s'], ['60', '12.5s', '2.2s'], ['67', '9s', '3.8s'],
  ['75', '11s', '0.9s'], ['82', '10.5s', '2.8s'], ['89', '12s', '1.5s'],
  ['8', '10s', '4.4s'], ['48', '9.5s', '4.9s'], ['68', '11.5s', '4.2s'],
  ['92', '10s', '5.3s'],
];

const JACK_DELAYS = ['0s', '0.6s', '1.2s', '1.8s', '2.4s', '3.0s'];
const JACK_DELAYS_RIGHT = ['0.3s', '0.9s', '1.5s', '2.1s', '2.7s', '3.3s'];

export default function AdminLoginPage() {
  const { login } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'success'>('idle');
  const [fieldErrors, setFieldErrors] = useState<{ email?: boolean; password?: boolean }>({});
  const [serverError, setServerError] = useState('');
  const [tilt, setTilt] = useState('');

  const handleTilt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    setTilt(`rotateY(${(x * 5).toFixed(3)}deg) rotateX(${(-y * 5).toFixed(3)}deg)`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'connecting' || status === 'success') return;

    setServerError('');
    const nextErrors = {
      email: !email.trim(),
      password: !password.trim(),
    };
    setFieldErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setStatus('connecting');
    try {
      const res = await auth.login(email, password);
      if (res.data.user.role !== 'ADMIN' && res.data.user.role !== 'SUPER_ADMIN') {
        setStatus('idle');
        setServerError('Access denied. Admin credentials required.');
        return;
      }
      login(res.data.user, res.data.token);
      setStatus('success');
      // Rebuild the protected console from the newly stored session.
      window.location.assign('/dashboard');
    } catch (err: any) {
      setStatus('idle');
      setServerError(err.message || 'Login failed');
    }
  };

  return (
    <div className="admin-auth">
      <style>{adminAuthStyles}</style>

      <div className="patchboard" aria-hidden="true">
        <div className="jack-row left">
          {JACK_DELAYS.map((d, i) => (
            <div className="jack" key={i} style={{ animationDelay: d }} />
          ))}
        </div>
        <div className="jack-row right">
          {JACK_DELAYS_RIGHT.map((d, i) => (
            <div className="jack" key={i} style={{ animationDelay: d }} />
          ))}
        </div>
      </div>

      <div className="grain-corner" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div className="status-corner"><span className="dot"></span>Board live</div>

      <div className="card-wrap" onMouseMove={handleTilt} onMouseLeave={() => setTilt('')}>
        <div className="card" style={{ transform: tilt }}>

          <div className="mark reveal" style={{ animationDelay: '.05s' }}>
            <svg viewBox="0 0 24 24"><path d="M6 8v8a6 6 0 0012 0V8M6 8a2 2 0 100-4 2 2 0 000 4zm12 0a2 2 0 100-4 2 2 0 000 4z" /></svg>
          </div>

          <div className="card-eyebrow reveal" style={{ animationDelay: '.1s' }}>
            <span className="dot"></span>Switchboard · Admin
          </div>
          <h1 className="card-title reveal" style={{ animationDelay: '.15s' }}>Admin Dashboard</h1>
          <div className="card-sub reveal" style={{ animationDelay: '.2s' }}>Sign in to manage your call center simulator</div>

          <form onSubmit={handleSubmit} noValidate suppressHydrationWarning>
            <div className={`field reveal ${fieldErrors.email ? 'invalid' : ''}`} style={{ animationDelay: '.25s' }}>
              <label htmlFor="email">Email</label>
              <div className="input-shell">
                <svg className="input-icon" viewBox="0 0 24 24"><path d="M4 6h16v12H4z" /><path d="M4 7l8 6 8-6" /></svg>
                <input
                  type="email"
                  id="email"
                  placeholder="admin@poshnee.com"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setFieldErrors((f) => ({ ...f, email: false })); }}
                  suppressHydrationWarning
                />
              </div>
              <div className="field-error">Enter your admin email to continue.</div>
            </div>

            <div className={`field reveal ${fieldErrors.password ? 'invalid' : ''}`} style={{ animationDelay: '.3s' }}>
              <label htmlFor="password">Password</label>
              <div className="input-shell">
                <svg className="input-icon" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="9" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
                <input
                  type={showPass ? 'text' : 'password'}
                  id="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setFieldErrors((f) => ({ ...f, password: false })); }}
                  suppressHydrationWarning
                />
                <button
                  type="button"
                  className="toggle-pass"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPass(!showPass)}
                >
                  <svg viewBox="0 0 24 24">
                    {showPass ? (
                      <>
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.6a2 2 0 002.8 2.8" />
                        <path d="M6.6 6.6C4 8.3 2 12 2 12s4 7 11 7c1.8 0 3.4-.4 4.8-1.1M17.9 17.9C20.4 16.1 22 12 22 12s-1.6-4-4.5-6" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              <div className="field-error">Enter your password to continue.</div>
            </div>

            {serverError && (
              <div className="form-error reveal" style={{ animationDelay: '.36s' }}>{serverError}</div>
            )}

            <button
              type="submit"
              className={`btn-signin reveal ${status === 'connecting' ? 'connecting' : ''} ${status === 'success' ? 'success' : ''}`}
              style={{ animationDelay: '.35s' }}
              disabled={status === 'connecting' || status === 'success'}
            >
              <span className="spinner"></span>
              <svg className="check" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>
              <span className="label">{status === 'success' ? 'Connected' : 'Sign In'}</span>
            </button>
          </form>

          <div className="divider-note reveal" style={{ animationDelay: '.4s' }}>
            <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
            Secured session · encrypted in transit
            <span className="eq" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>
          </div>

          <div className="card-footer reveal" style={{ animationDelay: '.45s' }}>Poshnee Training Hub · Restricted Access</div>
        </div>
      </div>

      {MOTES.map(([left, duration, delay], i) => (
        <div
          className="mote"
          key={i}
          style={{ left: `${left}vw`, bottom: '-10px', animationDuration: duration, animationDelay: delay }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

const adminAuthStyles = `
  .admin-auth {
    --paper:#FBF9F8; --paper-raised:#FFFFFF; --ink:#1E1520; --ink-mute:#6E6674;
    --line:#E4DCE6; --brass:#2E1B33; --brass-deep:#40284A; --brass-light:#DE8A24;
    --good:#406B4B; --bad:#B3261E;

    box-sizing: border-box;
    min-height: 100vh; position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center; padding: 40px 20px;
    color: var(--ink);
    font-family: 'Inter', var(--font-body), sans-serif;
    background:
      radial-gradient(ellipse at 20% 15%, rgba(255,255,255,0.05), transparent 40%),
      radial-gradient(ellipse at 80% 85%, rgba(0,0,0,0.2), transparent 50%),
      linear-gradient(160deg, #5A3A66 0%, #40284A 55%, #2E1B33 100%);
  }
  .admin-auth * { box-sizing: border-box; }
  .admin-auth::before {
    content: ""; position: absolute; inset: 0; opacity: .045; pointer-events: none; z-index: 1;
    background-image: repeating-linear-gradient(0deg, transparent, transparent 27px, #fff 28px);
  }

  /* ── ambient patchboard ── */
  .admin-auth .patchboard { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
  .admin-auth .jack-row { position: absolute; display: flex; flex-direction: column; gap: 26px; }
  .admin-auth .jack-row.left { left: 56px; top: 50%; transform: translateY(-50%); }
  .admin-auth .jack-row.right { right: 56px; top: 50%; transform: translateY(-50%); }
  .admin-auth .jack {
    width: 9px; height: 9px; border-radius: 50%; position: relative;
    background: rgba(222,138,36,0.14); border: 1px solid rgba(222,138,36,0.22);
    animation: aa-jack-pulse 4.8s ease-in-out infinite;
  }
  @keyframes aa-jack-pulse {
    0%, 76%, 100% { background: rgba(222,138,36,0.14); box-shadow: none; }
    83% { background: var(--brass-light); box-shadow: 0 0 10px 2px rgba(222,138,36,0.65); }
    90% { background: rgba(222,138,36,0.14); box-shadow: none; }
  }

  .admin-auth .mote {
    position: absolute; width: 3px; height: 3px; border-radius: 50%;
    background: rgba(246,241,247,0.5); animation: aa-drift linear infinite; z-index: 0;
  }
  @keyframes aa-drift {
    from { transform: translateY(0) translateX(0); opacity: 0; }
    10% { opacity: .5; }
    90% { opacity: .5; }
    to { transform: translateY(-120px) translateX(14px); opacity: 0; }
  }

  .admin-auth .grain-corner {
    position: absolute; top: 34px; left: 40px; display: flex; gap: 6px; z-index: 2;
  }
  .admin-auth .grain-corner span { width: 6px; height: 6px; border-radius: 50%; background: rgba(246,241,247,0.18); }
  .admin-auth .grain-corner span:first-child { background: var(--brass-light); animation: aa-jack-pulse 4.8s ease-in-out infinite; }

  .admin-auth .status-corner {
    position: absolute; top: 34px; right: 40px; display: flex; align-items: center; gap: 7px; z-index: 2;
    font-family: var(--font-mono-auth), 'IBM Plex Mono', monospace; font-size: 10px;
    letter-spacing: .1em; text-transform: uppercase; color: #9C8CA3;
  }
  .admin-auth .status-corner .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--good); animation: aa-pulse 2s ease-in-out infinite; }
  @keyframes aa-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }

  /* ── card ── */
  .admin-auth .card-wrap { perspective: 900px; z-index: 1; animation: aa-fade-up .6s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes aa-fade-up {
    from { opacity: 0; transform: translateY(16px) scale(.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  .admin-auth .card {
    width: 380px; max-width: 100%; background: var(--paper-raised);
    border: 1px solid rgba(228,220,230,0.4); border-radius: 16px;
    padding: 38px 34px 32px; box-shadow: 0 20px 50px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2);
    position: relative; transform-style: preserve-3d; transition: transform .25s ease;
  }
  .admin-auth .reveal { opacity: 0; animation: aa-field-in .5s ease both; }
  @keyframes aa-field-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .admin-auth .mark {
    width: 52px; height: 52px; border-radius: 12px; margin: 0 auto 20px; background: var(--brass);
    display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(46,27,51,0.35);
    position: relative;
  }
  .admin-auth .mark::after {
    content: ""; position: absolute; inset: -4px; border-radius: 16px; border: 1px solid var(--brass-light);
    opacity: 0; animation: aa-ring 3.2s ease-out infinite;
  }
  @keyframes aa-ring {
    0% { opacity: .55; transform: scale(.9); }
    100% { opacity: 0; transform: scale(1.35); }
  }
  .admin-auth .mark svg { width: 24px; height: 24px; stroke: #fff; fill: none; stroke-width: 2; position: relative; z-index: 1; }

  .admin-auth .card-eyebrow {
    text-align: center; font-family: var(--font-mono-auth), 'IBM Plex Mono', monospace; font-size: 10px;
    letter-spacing: .14em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 8px;
    display: flex; align-items: center; justify-content: center; gap: 7px;
  }
  .admin-auth .card-eyebrow .dot { width: 5px; height: 5px; border-radius: 50%; background: var(--brass); animation: aa-pulse 2s ease-in-out infinite; }
  .admin-auth .card-title {
    text-align: center; font-family: var(--font-display-auth), 'Fraunces', serif; font-weight: 600;
    font-size: 25px; margin: 0 0 6px; letter-spacing: -.01em; color: var(--ink);
  }
  .admin-auth .card-sub { text-align: center; color: var(--ink-mute); font-size: 13px; margin-bottom: 28px; }

  .admin-auth .field { margin-bottom: 16px; position: relative; }
  .admin-auth .field label { display: block; font-size: 12.5px; font-weight: 600; margin-bottom: 7px; color: var(--ink); }
  .admin-auth .field .input-shell { position: relative; }
  .admin-auth .field .input-icon {
    position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
    width: 15px; height: 15px; stroke: #9C8CA3; fill: none; stroke-width: 2; transition: stroke .18s ease;
    pointer-events: none;
  }
  .admin-auth .field input {
    width: 100%; padding: 11px 36px 11px 36px; border: 1px solid var(--line); border-radius: 9px;
    background: #fff; font-size: 13.5px; font-family: 'Inter', var(--font-body), sans-serif; color: var(--ink);
    transition: border-color .18s ease, box-shadow .18s ease;
  }
  .admin-auth .field input::placeholder { color: #9C8CA3; }
  .admin-auth .field input:focus { outline: none; border-color: var(--brass); box-shadow: 0 0 0 3px rgba(46,27,51,0.14); }
  .admin-auth .field input:focus ~ .input-icon { stroke: var(--brass); }

  .admin-auth .toggle-pass {
    position: absolute; right: 11px; top: 50%; transform: translateY(-50%); background: none; border: none;
    cursor: pointer; padding: 2px; line-height: 0;
  }
  .admin-auth .toggle-pass svg { width: 15px; height: 15px; stroke: #9C8CA3; fill: none; stroke-width: 1.8; transition: stroke .18s ease; }
  .admin-auth .toggle-pass:hover svg { stroke: var(--brass); }

  .admin-auth .field-error {
    font-size: 11px; color: var(--bad); margin-top: 6px; height: 0; overflow: hidden; opacity: 0;
    transition: opacity .18s ease;
  }
  .admin-auth .field.invalid input { border-color: var(--bad); animation: aa-shake .32s ease; }
  .admin-auth .field.invalid .field-error { height: auto; opacity: 1; }
  @keyframes aa-shake {
    0%,100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }

  .admin-auth .form-error {
    background: rgba(179,38,30,0.14); border: 1px solid rgba(179,38,30,0.4);
    color: #B3261E; border-radius: 9px; padding: 10px 14px; font-size: 13px; font-weight: 500; margin-bottom: 14px;
    text-align: center;
  }

  .admin-auth .btn-signin {
    width: 100%; background: var(--brass); color: #fff; border: none; padding: 13px; border-radius: 9px;
    font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 8px;
    box-shadow: 0 4px 12px rgba(46,27,51,0.28); transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
    position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 8px;
    font-family: 'Inter', var(--font-body), sans-serif;
  }
  .admin-auth .btn-signin:hover { background: var(--brass-deep); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(46,27,51,0.35); }
  .admin-auth .btn-signin:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(46,27,51,0.3); }
  .admin-auth .btn-signin::before {
    content: ""; position: absolute; inset: 0; background: rgba(255,255,255,0.18);
    transform: translateX(-100%); transition: transform .5s ease;
  }
  .admin-auth .btn-signin.connecting::before { transform: translateX(0); }
  .admin-auth .btn-signin .label, .admin-auth .btn-signin .spinner, .admin-auth .btn-signin .check { position: relative; z-index: 1; }
  .admin-auth .btn-signin .spinner {
    width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35);
    border-top-color: #fff; display: none; animation: aa-spin .7s linear infinite;
  }
  .admin-auth .btn-signin .check { display: none; width: 15px; height: 15px; stroke: #fff; fill: none; stroke-width: 2.6; }
  .admin-auth .btn-signin.connecting .label { display: none; }
  .admin-auth .btn-signin.connecting .spinner { display: inline-block; }
  .admin-auth .btn-signin.success { background: var(--good); }
  .admin-auth .btn-signin.success .spinner { display: none; }
  .admin-auth .btn-signin.success .check { display: inline-block; animation: aa-check-pop .4s ease; }
  .admin-auth .btn-signin.success .label { display: inline; }
  .admin-auth .btn-signin:disabled { cursor: wait; }
  @keyframes aa-spin { to { transform: rotate(360deg); } }
  @keyframes aa-check-pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

  .admin-auth .eq { display: flex; align-items: flex-end; gap: 2px; height: 12px; }
  .admin-auth .eq span {
    width: 2px; background: var(--brass-light); border-radius: 1px;
    animation: aa-eq-bar 1.1s ease-in-out infinite;
  }
  .admin-auth .eq span:nth-child(1) { animation-delay: 0s; }
  .admin-auth .eq span:nth-child(2) { animation-delay: .12s; }
  .admin-auth .eq span:nth-child(3) { animation-delay: .24s; }
  .admin-auth .eq span:nth-child(4) { animation-delay: .36s; }
  .admin-auth .eq span:nth-child(5) { animation-delay: .48s; }
  @keyframes aa-eq-bar { 0%,100% { height: 3px; } 50% { height: 12px; } }

  .admin-auth .divider-note {
    display: flex; align-items: center; gap: 8px; justify-content: center; margin-top: 22px;
    font-family: var(--font-mono-auth), 'IBM Plex Mono', monospace; font-size: 10px;
    color: var(--ink-mute); letter-spacing: .04em;
  }
  .admin-auth .divider-note svg { width: 12px; height: 12px; stroke: var(--ink-mute); fill: none; stroke-width: 2; }

  .admin-auth .card-footer {
    text-align: center; margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line);
    font-family: var(--font-mono-auth), 'IBM Plex Mono', monospace; font-size: 9.5px;
    letter-spacing: .08em; text-transform: uppercase; color: #9C8CA3;
  }

  @media (max-width: 460px) {
    .admin-auth .jack-row { display: none; }
    .admin-auth .card { width: 92vw; padding: 32px 24px 26px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .admin-auth *,
    .admin-auth *::before,
    .admin-auth *::after {
      animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important;
    }
    .admin-auth .card { transform: none !important; }
  }
`;
