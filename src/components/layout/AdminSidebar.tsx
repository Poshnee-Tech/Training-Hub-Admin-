'use client';

/**
 * Admin sidebar — the switchboard patch panel.
 *
 * Same sections and same routes as before; the structure is unchanged so every
 * page that already renders `<AdminSidebar />` next to an `ml-64` main keeps
 * working untouched. Width stays 16rem for exactly that reason.
 *
 * Where the agent portal is the "training floor", this is the board behind it:
 * each section carries its own accent, and the active row patches in with a
 * glowing line marker rather than a flat tinted background.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { LogoTile } from '@/components/brand/Logo';
import { useAuthStore } from '@/store/auth.store';

/**
 * `accent` groups the nav by what each section touches — signal = people,
 * cyan = training content, amber = call records, mint = insight. It is what
 * stops the panel reading as ten identical rows.
 */
/**
 * The ten sections, in four groups.
 *
 * They used to be one flat list of ten. The colour on each item hinted at a
 * grouping the design already had in mind — it just never said what the groups
 * were, and the hint only appeared on the item you were already standing on.
 * The headings say it outright instead.
 *
 * The per-item accent colour is gone with them. Three of the four resolved to
 * dark plum or moss, which were close to invisible once the rail became plum;
 * the active item is now amber in every group, matching the agent portal.
 */
const NAV_GROUPS = [
  {
    heading: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', glyph: GaugeGlyph },
      { href: '/analytics', label: 'Analytics', glyph: ChartGlyph },
    ],
  },
  {
    heading: 'People',
    items: [
      { href: '/signup-requests', label: 'Signup Requests', glyph: InboxGlyph },
      { href: '/agents', label: 'Agents', glyph: UsersGlyph },
      { href: '/assignments', label: 'Assign Customers', glyph: ClipboardGlyph },
    ],
  },
  {
    heading: 'Training material',
    items: [
      { href: '/content/knowledge', label: 'Product Knowledge', glyph: BookGlyph },
      { href: '/content/screens', label: 'Knowledge Screens', glyph: ScreenGlyph },
      { href: '/content/quizzes', label: 'Quizzes', glyph: CheckGlyph },
      { href: '/scenarios', label: 'Scenarios', glyph: ListGlyph },
      { href: '/content/clips', label: 'Best Practice Clips', glyph: FilmGlyph },
      { href: '/content/pronunciation', label: 'Pronunciation', glyph: MicrophoneGlyph },
    ],
  },
  {
    heading: 'Call activity',
    items: [
      { href: '/calls', label: 'Call History', glyph: PhoneGlyph },
      { href: '/recordings', label: 'Recordings', glyph: HeadsetGlyph },
    ],
  },
  /**
   * Settings reached the nav on 2026-09-11. It was only ever linked from
   * inside the account menu, and labelled "Change password" — so the switch
   * that decides what every trainee sees on their report lived behind a
   * collapsed menu named after something else, and was reported as missing.
   */
  {
    heading: 'Configuration',
    items: [
      { href: '/settings', label: 'Settings', glyph: CogGlyph },
    ],
  },
] as const;

/** `Training material` -> `nav-training-material`, for aria-labelledby. */
const groupId = (heading: string) => 'nav-' + heading.toLowerCase().replace(/\s+/g, '-');

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Close the account menu when clicking anywhere outside it. Failed logins
  // and scattered mousedown events otherwise leave it hanging open behind the
  // next page. Sign out and Change password close it themselves too.
  useEffect(() => {
    if (!accountOpen) return;
    const onDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [accountOpen]);

  return (
    <aside id="admin-sidebar" className="air-rail fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r">
      {/* select-none: the brand is not a link or an input — clicking it must not
          raise a text caret. */}
      <div className="air-hairline flex h-[74px] shrink-0 select-none items-center gap-3 border-b px-5 cursor-default">
        {/* The shared brand mark. Same component the agent portal renders,
            so the two apps cannot drift apart. */}
        <LogoTile className="h-10 w-10 shrink-0" radius={11} />
        <span className="min-w-0">
          {/* Stacked for the same reason as the agent rail — the full name is
              too wide for a 256px column beside the mark. */}
          <span className="block font-display text-[17px] font-extrabold leading-none tracking-[-0.02em] text-air-text">
            Poshnee
          </span>
          <span className="mt-1 block font-mono-ui text-[8.5px] uppercase tracking-[0.16em] text-air-faint">
            Training Hub · Admin
          </span>
        </span>
      </div>

      <nav className="sidebar-scroll flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Admin sections">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} role="group" aria-labelledby={groupId(group.heading)}>
            <span
              id={groupId(group.heading)}
              className="block px-3 pb-2 font-mono-ui text-[10.5px] uppercase tracking-[0.12em] text-air-faint"
            >
              {group.heading}
            </span>

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname.startsWith(item.href);
                const Glyph = item.glyph;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-colors',
                      active
                        ? 'bg-air-line/[0.10] text-air-text'
                        : 'text-air-muted hover:bg-air-line/[0.06] hover:text-air-text',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute -left-3 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-air-signal transition-opacity duration-200',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden
                    />
                    <Glyph
                      className={cn(
                        'h-[17px] w-[17px] shrink-0 stroke-current transition-colors',
                        active ? 'text-air-signal' : 'text-air-faint group-hover:text-air-muted',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="air-hairline shrink-0 border-t p-4">
        <div className="relative flex items-center gap-2" ref={accountRef}>
          {/* Account/role chip — the password and sign-out actions live behind
              this toggle so a routine dashboard visit never offers them. */}
          <button
            type="button"
            onClick={() => setAccountOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-air-line/[0.06]"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-air-signal to-air-cyan font-display text-[13px] font-bold text-white">
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-air-text">
                {user?.firstName} {user?.lastName}
              </span>
              <span className="block truncate font-mono-ui text-[9px] uppercase tracking-[0.14em] text-air-faint">
                {user?.role}
              </span>
            </span>
            <span className="shrink-0 transition-transform duration-200" style={{ transform: accountOpen ? 'rotate(180deg)' : undefined }}>
              <ChevronGlyph className="h-3.5 w-3.5 stroke-air-faint" />
            </span>
          </button>

          {accountOpen && (
            <div
              role="menu"
              className="air-panel absolute bottom-full left-0 z-20 mb-2 w-full rounded-xl border p-1.5"
            >
              <Link
                href="/settings"
                role="menuitem"
                onClick={() => setAccountOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 font-mono-ui text-[10px] font-bold uppercase tracking-[0.14em] text-air-faint transition-colors hover:bg-air-line/[0.08] hover:text-air-signal-bright"
              >
                <CogGlyph className="h-3.5 w-3.5 stroke-current" />
                Settings
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setAccountOpen(false); logout(); router.push('/login'); }}
                className="w-full rounded-lg px-3 py-2.5 text-left font-mono-ui text-[10px] font-bold uppercase tracking-[0.14em] text-air-faint transition-colors hover:bg-air-live/10 hover:text-air-live"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── glyphs ────────────────────────────────────────────────────
const S = { fill: 'none', strokeWidth: 1.8, viewBox: '0 0 24 24', 'aria-hidden': true } as const;
const d = (path: string) => <path strokeLinecap="round" strokeLinejoin="round" d={path} />;

function InboxGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d("M2.25 13.5h3.86c.42 0 .8.23 1 .61l.88 1.66c.2.38.58.61 1 .61h3.02c.42 0 .8-.23 1-.61l.88-1.66c.2-.38.58-.61 1-.61h3.86M2.25 13.5V6.75A2.25 2.25 0 0 1 4.5 4.5h15a2.25 2.25 0 0 1 2.25 2.25v6.75m-19.5 0v3.75A2.25 2.25 0 0 0 4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V13.5")}</svg>;
}
function GaugeGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941')}</svg>;
}
function UsersGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z')}</svg>;
}
function ClipboardGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184')}</svg>;
}
function BookGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25')}</svg>;
}
function ScreenGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M2.25 12.75V12a2.25 2.25 0 012.25-2.25h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z')}</svg>;
}
function CheckGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z')}</svg>;
}
function FilmGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M3.375 19.5h17.25M3.375 19.5a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m18.375 12.75V5.625M20.625 4.5H3.375M6 5.625v12.75m0-12.75h12m0 0v12.75M9 9.75h6M9 12h6m-6 2.25h6')}</svg>;
}
function MicrophoneGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M12 18.75a6 6 0 006-6v-1.5m-12 0v1.5a6 6 0 006 6m0 0v3m-3 0h6M12 15.75a3 3 0 003-3v-7.5a3 3 0 00-6 0v7.5a3 3 0 003 3z')}</svg>;
}
function PhoneGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z')}</svg>;
}
function HeadsetGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M3.75 12a8.25 8.25 0 0116.5 0m-16.5 0v4.5a2.25 2.25 0 002.25 2.25H7.5V12H3.75zm16.5 0v4.5a2.25 2.25 0 01-2.25 2.25H16.5V12h3.75z')}</svg>;
}
function ListGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zM3.75 12h.007v.008H3.75V12zm0 5.25h.007v.008H3.75v-.008z')}</svg>;
}
function ChartGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S}>{d('M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z')}</svg>;
}
function CogGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2}>{d('M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281z')}{d('M15 12a3 3 0 11-6 0 3 3 0 016 0z')}</svg>;
}
function ChevronGlyph({ className }: { className?: string }) {
  return <svg className={className} {...S} strokeWidth={2}>{d('M19.5 8.25l-7.5 7.5-7.5-7.5')}</svg>;
}
