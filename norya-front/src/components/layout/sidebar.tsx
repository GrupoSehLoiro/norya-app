'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';

interface NavItem {
  href: string;
  label: string;
  group?: string;
  icon: React.ReactNode;
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
  { href: '/insights',     label: 'Pulso da live',      group: 'Social listening', icon: <Icon d="M22 12h-4l-3 9L9 3l-3 9H2" /> },
  { href: '/batches',      label: 'Mensagens do chat',  group: 'Social listening', icon: <Icon d="M3 3h18v18H3zM3 9h18M9 21V9" /> },
  { href: '/brands',       label: 'Marcas',             group: 'Social listening', icon: <Icon d="M20.91 8.84 8.56 21.18a4.5 4.5 0 0 1-6.36-6.36L14.55 2.47M13 7l4 4" /> },
  // Moderação — herança dos bots, reempacotada num lugar que faz sentido pro
  // streamer (antes viviam soltas no grupo "Legado").
  { href: '/legacy/bans',     label: 'Bans',                group: 'Moderação', icon: <Icon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM5 5l14 14" /> },
  { href: '/legacy/timeouts', label: 'Timeouts',            group: 'Moderação', icon: <Icon d="M12 8v4l3 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20z" /> },
  { href: '/legacy/removed',  label: 'Mensagens removidas', group: 'Moderação', icon: <Icon d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /> },

  // Engajamento — o que a audiência votou/palpitou e como se expressou.
  { href: '/legacy/polls',       label: 'Enquetes',    group: 'Engajamento', icon: <Icon d="M3 12h4v9H3zM10 3h4v18h-4zM17 8h4v13h-4z" /> },
  { href: '/legacy/predictions', label: 'Predictions', group: 'Engajamento', icon: <Icon d="M3 17l6-6 4 4 8-8M14 7h7v7" /> },
  { href: '/legacy/emojis',      label: 'Emojis',      group: 'Engajamento', icon: <Icon d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /> },

  // Conectar Twitch/Kick saiu do menu: a conexão acontece pela página Canais
  // (modal "Conectar"), e o OAuth volta pra lá. As rotas /integrations/* foram
  // desativadas (redirecionam pra /channels). "Histórico de lives" também saiu.

  // Admin — operação/observabilidade. Só admin; nasce recolhido.
  { href: '/ai-training',  label: 'Treinamento IA', group: 'Admin', adminOnly: true, icon: <Icon d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7zM9 21h6" /> },
  { href: '/metrics',      label: 'Métricas da IA', group: 'Admin', adminOnly: true, icon: <Icon d="M3 3v18h18M7 14l4-4 4 4 5-5" /> },
  { href: '/ai-budget',    label: 'Custo de IA',    group: 'Admin', adminOnly: true, icon: <Icon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /> },
  { href: '/feature-flags', label: 'Feature flags', group: 'Admin', adminOnly: true, icon: <Icon d="M6 3v18M18 3v18M3 6h18M3 18h18" /> },
  { href: '/logs',          label: 'Access logs',   group: 'Admin', adminOnly: true, icon: <Icon d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" /> },
  { href: '/access',        label: 'Gerenciador de acesso', group: 'Admin', adminOnly: true, icon: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h1M16 16l2 2 4-4" /> },
];

// Grupos secundários nascem recolhidos para o menu respirar — o streamer foca
// no topo (Início/Canais/Social listening). Vale só no 1º acesso; depois o
// estado escolhido pelo usuário é respeitado.
const DEFAULT_COLLAPSED = ['Moderação', 'Engajamento', 'Admin'];

const STORAGE_KEY = 'norya:sidebar-collapsed-groups';
const SLIM_KEY = 'norya:sidebar-slim';

function loadCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    // 1º acesso (sem estado salvo) → aplica os grupos secundários recolhidos.
    if (raw === null) return new Set(DEFAULT_COLLAPSED);
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((s): s is string => typeof s === 'string')) : new Set();
  } catch {
    return new Set(DEFAULT_COLLAPSED);
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

  // Agrupa preservando ordem de inserção (primeiro item de cada grupo define
  // posição). Toda subcategoria nomeada é colapsável (accordion) — pedido do
  // design pra reduzir a altura do menu.
  const visibleItems = items.filter((it) => !it.adminOnly || isAdmin);
  const groups: { name: string; items: NavItem[]; collapsible: boolean }[] = [];
  const groupIndex = new Map<string, number>();
  for (const it of visibleItems) {
    const key = it.group ?? '';
    let idx = groupIndex.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(key, idx);
      groups.push({ name: key, items: [], collapsible: key !== '' });
    }
    groups[idx]!.items.push(it);
  }

  const path = pathname ?? '';

  return (
    <aside
      className={cn(
        'hidden md:flex md:flex-col',
        'sticky top-6 z-10',
        'h-[calc(100vh-48px)] flex-shrink-0',
        'glass-surface gap-5 overflow-y-auto',
        'transition-[width] duration-200',
        slim ? 'w-[64px] p-[18px_10px]' : 'w-[244px] p-[18px_14px]',
      )}
    >
      {/* Logo em cima do menu: wordmark expandida, símbolo quando recolhida. */}
      <div className={cn('flex items-center', slim ? 'flex-col gap-2' : 'justify-between pl-2.5 pr-1')}>
        <Link
          href="/dashboard"
          aria-label="Norya (início)"
          className="text-accent-400 transition-opacity hover:opacity-80"
        >
          {slim ? (
            <span className="text-[22px] font-bold tracking-tight">N</span>
          ) : (
            <span className="text-[22px] font-bold tracking-tight">Norya</span>
          )}
        </Link>
        <button
          type="button"
          onClick={toggleSlim}
          aria-label={slim ? 'Expandir menu' : 'Recolher menu'}
          title={slim ? 'Expandir menu' : 'Recolher menu'}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg text-ink-400',
            'transition-colors hover:bg-white/[0.04] hover:text-ink-700',
          )}
        >
          {/* Símbolo padrão de recolher/expandir painel lateral */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
            {slim ? <path d="m14 9 3 3-3 3" /> : <path d="m17 15-3-3 3-3" />}
          </svg>
        </button>
      </div>

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
