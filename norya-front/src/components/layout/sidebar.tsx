'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { SidebarChannelPicker } from './sidebar-channel-picker';
import { useAuth } from '@/hooks/use-auth';

interface NavItem {
  href: string;
  label: string;
  group?: string;
  icon: React.ReactNode;
  /** Marca o grupo como collapsible (accordion). Default false. */
  collapsibleGroup?: boolean;
  /** Só aparece para owner/admin do workspace. */
  adminOnly?: boolean;
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 opacity-70 transition-opacity"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const items: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Início',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
        className="flex-shrink-0 opacity-70" aria-hidden>
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </svg>
    ),
  },
  { href: '/channels',     label: 'Canais',             icon: <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /> },
  { href: '/insights',     label: 'Análise de sentimentos', group: 'IA Core', icon: <Icon d="M22 12h-4l-3 9L9 3l-3 9H2" /> },
  { href: '/batches',      label: 'Mensagens do chat',  group: 'IA Core',     icon: <Icon d="M3 3h18v18H3zM3 9h18M9 21V9" /> },
  { href: '/brands',       label: 'Marcas',             group: 'IA Core',     icon: <Icon d="M20.91 8.84 8.56 21.18a4.5 4.5 0 0 1-6.36-6.36L14.55 2.47M13 7l4 4" /> },
  { href: '/ad-control',   label: 'Anúncios',           group: 'IA Core',     icon: <Icon d="M5 3l14 9-14 9z" /> },
  { href: '/sessions',     label: 'Sessões ao vivo',    group: 'Ingestão',    icon: <Icon d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /> },
  { href: '/integrations/twitch', label: 'Twitch', group: 'Integrações', icon: <Icon d="M4 3l16 0 0 14-4 4-3 0-3 3-3 0 0-3-3 0z" /> },
  { href: '/integrations/kick',   label: 'Kick',   group: 'Integrações', icon: <Icon d="M5 3v18l5-5h9V3z" /> },
  { href: '/ai-training',  label: 'Treinamento IA', group: 'Admin', adminOnly: true, icon: <Icon d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7zM9 21h6" /> },
  { href: '/metrics',      label: 'Métricas IA',   group: 'Admin', adminOnly: true, icon: <Icon d="M3 3v18h18M7 14l4-4 4 4 5-5" /> },
  { href: '/feature-flags', label: 'Feature flags', group: 'Admin', adminOnly: true, icon: <Icon d="M6 3v18M18 3v18M3 6h18M3 18h18" /> },
  { href: '/logs',          label: 'Access logs',   group: 'Admin', adminOnly: true, icon: <Icon d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" /> },
  { href: '/access',        label: 'Gerenciador de acesso', group: 'Admin', adminOnly: true, icon: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h1M16 16l2 2 4-4" /> },
  // Legado — collapsible. Features que vieram da SLMOD-api Express; serão
  // absorvidas por bounded contexts vivos no M5. Ver docs/technical/legacy-module.md.
  { href: '/legacy/bans',        label: 'Bans',        group: 'Legado', collapsibleGroup: true, icon: <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM5 5l14 14" /> },
  { href: '/legacy/timeouts',    label: 'Timeouts',    group: 'Legado', collapsibleGroup: true, icon: <Icon d="M12 8v4l3 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z" /> },
  { href: '/legacy/removed',     label: 'Removidas',   group: 'Legado', collapsibleGroup: true, icon: <Icon d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /> },
  { href: '/legacy/predictions', label: 'Predictions', group: 'Legado', collapsibleGroup: true, icon: <Icon d="M3 17l6-6 4 4 8-8M14 7h7v7" /> },
  { href: '/legacy/polls',       label: 'Polls',       group: 'Legado', collapsibleGroup: true, icon: <Icon d="M3 12h4v9H3zM10 3h4v18h-4zM17 8h4v13h-4z" /> },
  { href: '/legacy/emojis',      label: 'Emojis',      group: 'Legado', collapsibleGroup: true, icon: <Icon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /> },
];

const STORAGE_KEY = 'sehloro:sidebar-collapsed-groups';
const SLIM_KEY = 'sehloro:sidebar-slim';

function loadCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((s): s is string => typeof s === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function persistCollapsed(set: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  // Grupo Admin/adminOnly usa o role GLOBAL do JWT (mesma claim que o
  // backend valida) — wsRole é papel de workspace e TODO usuário do signup
  // é owner do próprio workspace pessoal; usar wsRole aqui exporia o grupo
  // Admin para todo mundo.
  const isAdmin = user?.role === 'admin';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Recolhida = só ícones (64px). Persistido entre sessões.
  const [slim, setSlim] = useState(false);

  // Estado persistido entre sessões. Hidrata só no client p/ evitar SSR mismatch.
  useEffect(() => {
    setCollapsed(loadCollapsed());
    setSlim(window.localStorage.getItem(SLIM_KEY) === '1');
  }, []);

  function toggleSlim() {
    setSlim((v) => {
      window.localStorage.setItem(SLIM_KEY, v ? '0' : '1');
      return !v;
    });
  }

  function toggleGroup(group: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      persistCollapsed(next);
      return next;
    });
  }

  // Agrupa preservando ordem de inserção (primeiro item de cada grupo define posição).
  const visibleItems = items.filter((it) => !it.adminOnly || isAdmin);
  const groups: { name: string; items: NavItem[]; collapsible: boolean }[] = [];
  const groupIndex = new Map<string, number>();
  for (const it of visibleItems) {
    const key = it.group ?? '';
    let idx = groupIndex.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(key, idx);
      groups.push({ name: key, items: [], collapsible: false });
    }
    const target = groups[idx]!;
    target.items.push(it);
    if (it.collapsibleGroup) target.collapsible = true;
  }

  const path = pathname ?? '';

  return (
    <aside
      className={cn(
        'hidden md:flex md:flex-col',
        'sticky top-[88px] z-10',
        'h-[calc(100vh-104px)] flex-shrink-0',
        'glass-surface gap-5 overflow-y-auto',
        'transition-[width] duration-200',
        slim ? 'w-[64px] p-[18px_10px]' : 'w-[244px] p-[18px_14px]',
      )}
    >
      <button
        type="button"
        onClick={toggleSlim}
        aria-label={slim ? 'Expandir menu' : 'Recolher menu'}
        title={slim ? 'Expandir menu' : 'Recolher menu'}
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-ink-400',
          'transition-colors hover:bg-white/[0.04] hover:text-ink-700',
          slim && 'justify-center px-0',
        )}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('flex-shrink-0 transition-transform duration-200', slim && 'rotate-180')}
          aria-hidden
        >
          <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
        </svg>
        {!slim && <span>Recolher menu</span>}
      </button>

      {!slim && <SidebarChannelPicker />}

      {groups.map(({ name, items: list, collapsible }) => {
        const isCollapsed = !slim && collapsible && collapsed.has(name);
        const groupHasActive = list.some(
          (it) => path === it.href || (it.href !== '/dashboard' && path.startsWith(it.href)),
        );
        return (
          <div key={name} className="flex flex-col gap-0.5">
            {name && slim && (
              <span aria-hidden className="mx-2 mb-2 border-t border-white/[0.07]" />
            )}
            {name && !slim && (
              collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(name)}
                  className={cn(
                    'group flex items-center justify-between rounded-lg px-2.5 pb-2 pt-1 text-left',
                    'text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-400',
                    'transition-colors hover:text-ink-600',
                  )}
                  aria-expanded={!isCollapsed}
                >
                  <span className="flex items-center gap-1.5">
                    {name}
                    {groupHasActive && isCollapsed && (
                      <span className="h-1 w-1 rounded-full bg-accent-400" aria-hidden />
                    )}
                  </span>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 12 12"
                    fill="none"
                    className={cn(
                      'opacity-60 transition-transform duration-200',
                      isCollapsed ? '-rotate-90' : 'rotate-0',
                    )}
                    aria-hidden
                  >
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              ) : (
                <p className="px-2.5 pb-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-400">
                  {name}
                </p>
              )
            )}
            {!isCollapsed && (
              <ul className="flex flex-col gap-0.5">
                {list.map((it) => {
                  const active = path === it.href
                    || (it.href !== '/dashboard' && path.startsWith(it.href));
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        title={slim ? it.label : undefined}
                        className={cn(
                          'group flex items-center gap-2.5 rounded-lg py-2 text-[13.5px] font-medium',
                          slim ? 'justify-center px-0' : 'px-2.5',
                          'transition-colors ease-glass',
                          active
                            ? 'bg-gradient-to-br from-accent-300 to-accent-400 text-bg-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_rgba(215,254,1,0.25)]'
                            : 'text-ink-600 hover:bg-white/[0.04] hover:text-ink-800',
                        )}
                      >
                        <span className={cn(active ? 'text-bg-0' : '')}>{it.icon}</span>
                        {!slim && <span>{it.label}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

    </aside>
  );
}
