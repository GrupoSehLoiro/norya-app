'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { ThemeToggle } from './theme-toggle';
import { WorkspaceChip } from './workspace-chip';

export function Topbar() {
  const { user, logout } = useAuth();
  const initials = (user?.username ?? '?')
    .split(/[\s._-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="fixed inset-x-0 top-4 z-50 px-4">
      <div
        className={cn(
          'glass-surface mx-auto h-14 max-w-[1640px] px-4',
          'grid grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[244px_1fr_auto]',
        )}
      >
      <Link href="/dashboard" className="inline-flex items-center gap-2.5 text-ink-800">
        <span className="text-[24px] font-bold tracking-tight text-accent-400">
        Norya
        </span>
      </Link>

      <WorkspaceChip />

      <div className="inline-flex items-center gap-2.5">
        <ThemeToggle />
        <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-ink-600 lg:inline-flex">
          <span className="relative inline-block h-[7px] w-[7px] rounded-full bg-ok">
            <span className="absolute inset-[-3px] rounded-full bg-ok opacity-[0.18] animate-led-halo" />
          </span>
          Sistema operacional
        </span>

        {user ? (
          <>
            <span className="hidden text-xs text-ink-600 md:inline">{user.username}</span>
            <button
              onClick={logout}
              className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-ink-600 transition-colors hover:bg-white/[0.08] hover:text-ink-800"
            >
              Sair
            </button>
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent-300 to-accent-600 text-[12px] font-bold text-bg-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
              {initials}
            </span>
          </>
        ) : null}
      </div>
      </div>
    </header>
  );
}
