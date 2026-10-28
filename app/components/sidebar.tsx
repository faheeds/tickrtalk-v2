'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

// ─── SVG Icon set ─────────────────────────────────────────────────────────────
const icons = {
  overview: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm8-5a.75.75 0 01.75.75v4.5h2.75a.75.75 0 010 1.5H10a.75.75 0 01-.75-.75v-5.25A.75.75 0 0110 5z"/>
    </svg>
  ),
  portfolio: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M6 3.75A2.75 2.75 0 018.75 1h2.5A2.75 2.75 0 0114 3.75v.443c.572.055 1.14.122 1.706.2C17.053 4.582 18 5.75 18 7.07v3.469c0 1.126-.694 2.191-1.83 2.54-1.952.599-3.956.99-6.17.99-2.213 0-4.218-.391-6.17-.99C2.694 12.73 2 11.665 2 10.539V7.07c0-1.321.947-2.489 2.294-2.676A41.047 41.047 0 016 4.193V3.75zm6.5 0v.325a41.622 41.622 0 00-5 0V3.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25zM10 10a1 1 0 00-1 1v.01a1 1 0 001 1h.01a1 1 0 001-1V11a1 1 0 00-1-1H10z" clipRule="evenodd"/>
      <path d="M3 15.055v-.684c.126.053.255.1.39.142 2.1.642 4.301 1.013 6.61 1.013 2.31 0 4.51-.37 6.61-1.013.135-.041.264-.089.39-.142v.684C17 16.512 15.8 17.5 14.38 17.5H5.62C4.2 17.5 3 16.512 3 15.055z"/>
    </svg>
  ),
  watchlist: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/>
      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
    </svg>
  ),
  journal: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
    </svg>
  ),
  algo: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
      <path fillRule="evenodd" d="M8.34 1.804A1 1 0 019.32 1h1.36a1 1 0 01.98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 011.262.125l.962.962a1 1 0 01.125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 01.804.98v1.361a1 1 0 01-.804.98l-1.473.295a6.95 6.95 0 01-.587 1.416l.834 1.25a1 1 0 01-.125 1.262l-.962.962a1 1 0 01-1.262.125l-1.25-.834a6.953 6.953 0 01-1.416.587l-.294 1.473a1 1 0 01-.98.804H9.32a1 1 0 01-.98-.804l-.295-1.473a6.957 6.957 0 01-1.416-.587l-1.25.834a1 1 0 01-1.262-.125l-.962-.962a1 1 0 01-.125-1.262l.834-1.25a6.957 6.957 0 01-.587-1.416l-1.473-.294A1 1 0 011 10.68V9.32a1 1 0 01.804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 01.125-1.262l.962-.962A1 1 0 015.379 3.03l1.25.834a6.957 6.957 0 011.416-.587l.294-1.473zM13 10a3 3 0 11-6 0 3 3 0 016 0z" clipRule="evenodd"/>
    </svg>
  ),
}

const NAV = [
  { href: '/dashboard',           label: 'Overview',    icon: icons.overview   },
  { href: '/dashboard/portfolio', label: 'Portfolio',   icon: icons.portfolio  },
  { href: '/dashboard/watchlist', label: 'Watchlist',   icon: icons.watchlist  },
  { href: '/dashboard/journal',   label: 'Journal',     icon: icons.journal    },
  { href: '/dashboard/algo',      label: 'Algo Engine', icon: icons.algo       },
]

export default function Sidebar() {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col relative z-10"
      style={{
        background: 'rgba(6, 8, 20, 0.95)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(24px)',
      }}
    >
      {/* ── Logo ──────────────────────────────────────────────── */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          {/* Icon mark */}
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
              boxShadow: '0 4px 12px rgba(99,102,241,0.4)',
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
              <path d="M2 12L6 7L9 10L13 4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M11 4H13V6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          {/* Wordmark */}
          <div>
            <span
              className="text-[15px] font-bold tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #EEF2FF 0%, #818CF8 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              TickrTalk
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="live-dot" />
              <span style={{ fontSize: '9px', color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Live
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 mb-3" style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

      {/* ── Main Nav ──────────────────────────────────────────── */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map(({ href, label, icon }) => {
          const active = isActive(href)
          return (
            <div key={href} className="relative flex items-center">
              {/* Active left bar */}
              {active && (
                <div
                  className="absolute left-0"
                  style={{
                    width: '3px',
                    height: '28px',
                    background: 'linear-gradient(180deg, #6366F1, #8B5CF6)',
                    borderRadius: '0 4px 4px 0',
                    boxShadow: '0 0 10px rgba(99,102,241,0.7)',
                    left: '-12px',
                  }}
                />
              )}
              <Link
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-all duration-150"
                style={{
                  background: active
                    ? 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(139,92,246,0.1) 100%)'
                    : 'transparent',
                  color: active ? '#EEF2FF' : 'var(--ink-3)',
                  fontSize: '13px',
                  fontWeight: active ? '600' : '500',
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                  if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--ink-2)'
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
                  if (!active) (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)'
                }}
              >
                <span style={{ color: active ? '#818CF8' : 'var(--ink-3)', transition: 'color 0.15s' }}>
                  {icon}
                </span>
                {label}
              </Link>
            </div>
          )
        })}
      </nav>

      {/* ── Bottom section ────────────────────────────────────── */}
      <div className="px-3 pb-5 pt-3 space-y-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Settings */}
        <Link
          href="/dashboard/settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full transition-all duration-150"
          style={{
            background: pathname.startsWith('/dashboard/settings')
              ? 'rgba(255,255,255,0.07)'
              : 'transparent',
            color: pathname.startsWith('/dashboard/settings') ? 'var(--ink-2)' : 'var(--ink-3)',
            fontSize: '13px',
            fontWeight: '500',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-2)' }}
          onMouseLeave={e => {
            const active = pathname.startsWith('/dashboard/settings')
            ;(e.currentTarget as HTMLElement).style.background = active ? 'rgba(255,255,255,0.07)' : 'transparent'
            ;(e.currentTarget as HTMLElement).style.color = active ? 'var(--ink-2)' : 'var(--ink-3)'
          }}
        >
          {icons.settings}
          Settings
        </Link>

        {/* User */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'w-7 h-7',
                userButtonPopoverCard: 'bg-surface-1',
              },
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--ink-3)', fontWeight: '500' }}>Account</span>
        </div>
      </div>
    </aside>
  )
}
