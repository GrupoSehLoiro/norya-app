'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useMe, useEntitlements } from '@/hooks/use-me';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { api, setToken } from '@/lib/api-client';
import { fetchChannels, fetchSessions } from '@/lib/queries';
import { IconPlus, IconChevronDown, IconSettings } from '@/components/ui/icons';
import { ThemeToggle } from './theme-toggle';
import type { AuthTokensLite, ChannelV2 } from '@/lib/types';

/** Quantos canais aparecem antes de recolher atrás do "ver todos". */
const CHANNELS_CAP = 3;

/**
 * Menu flutuante do perfil (canto superior direito do conteúdo). Absorveu os
 * itens que viviam no Topbar — identidade, workspace (+ troca), tema, sair —
 * e o seletor de CANAL ATIVO, que agora vive DENTRO do bloco Workspace: os
 * canais são recursos do workspace, então a hierarquia visual reflete isso.
 * O avatar é o único elemento visível; o resto abre sob demanda.
 */
export function ProfileMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const me = useMe();
  const ent = useEntitlements();
  const qc = useQueryClient();
  const { channelId, setChannelId } = useSelectedChannel();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showAllChannels, setShowAllChannels] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Canais do workspace — a query vive aqui (montada sempre) porque o
  // auto-select do canal pós-onboarding precisa rodar mesmo com o menu fechado.
  const channels = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
    select: (xs) => xs.filter((c) => c.active !== false),
  });
  useEffect(() => {
    const list = channels.data;
    if (!list || list.length === 0) return;
    const valid = channelId && list.some((c) => c.id === channelId);
    if (!valid) setChannelId(list[0]!.id);
  }, [channels.data, channelId, setChannelId]);

  // Status ao vivo por canal — só busca com o menu aberto.
  const sessions = useQuery({
    enabled: open,
    queryKey: ['monitoring-sessions'],
    queryFn: fetchSessions,
    refetchInterval: open ? 10_000 : false,
  });
  const onlineMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sessions.data ?? []) {
      if (s.state === 'ACTIVE') m.set(s.channelId, true);
    }
    return m;
  }, [sessions.data]);

  // O canal ativo vem sempre primeiro — assim continua visível mesmo quando a
  // lista está recolhida em CHANNELS_CAP.
  const orderedChannels = useMemo(() => {
    const list = [...(channels.data ?? [])];
    list.sort((a, b) => Number(b.id === channelId) - Number(a.id === channelId));
    return list;
  }, [channels.data, channelId]);

  // Fechar ao clicar fora ou ESC.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Ao fechar, recolhe a lista de canais de novo (estado sempre previsível).
  useEffect(() => {
    if (!open) setShowAllChannels(false);
  }, [open]);

  if (!user) return null;

  // Nome de exibição é a identidade primária; cai pro username (email) só se
  // o perfil ainda não tiver um displayName.
  const displayName = me.data?.user.displayName?.trim() || user.username || '';

  const initials = (displayName || '?')
    .split(/[\s._@-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const active = me.data?.workspaces.find((w) => w.id === me.data!.activeWorkspaceId);
  const multi = (me.data?.workspaces.length ?? 0) > 1;
  const planLabel = ent.data?.plan.label ?? active?.planKey ?? 'free';

  const totalChannels = orderedChannels.length;
  const visibleChannels = showAllChannels
    ? orderedChannels
    : orderedChannels.slice(0, CHANNELS_CAP);
  const hiddenCount = totalChannels - CHANNELS_CAP;

  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  async function activate(id: string) {
    setSwitching(true);
    try {
      const res = await api.post<AuthTokensLite>(`/api/v2/auth/workspace/${id}/activate`);
      setToken(res.accessToken);
      await qc.invalidateQueries();
      window.location.reload();
    } finally {
      setSwitching(false);
      setOpen(false);
    }
  }

  function ChannelRow({ c }: { c: ChannelV2 }) {
    const isActive = c.id === channelId;
    const isOnline = onlineMap.get(c.id) === true;
    return (
      <button
        type="button"
        role="option"
        aria-selected={isActive}
        onClick={() => {
          setChannelId(c.id);
          setOpen(false);
        }}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]',
          'transition-colors ease-glass',
          isActive
            ? 'bg-gradient-to-br from-accent-300 to-accent-400 text-bg-0'
            : 'text-ink-700 hover:bg-white/[0.06] hover:text-ink-800',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 leading-none">
          <span
            className={cn(
              'inline-block h-2 w-2 flex-shrink-0 rounded-full',
              isActive ? 'bg-bg-0' : isOnline ? 'bg-ok' : 'bg-err',
            )}
            aria-hidden
          />
          <span className="truncate font-medium leading-none">{c.name}</span>
        </span>
        <span
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.10em]',
            isActive
              ? 'bg-bg-0/15 text-bg-0'
              : c.platform === 'twitch'
              ? 'bg-platform-twitch/15 text-platform-twitch'
              : 'bg-platform-kick/15 text-platform-kick',
          )}
        >
          {c.platform}
        </span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className="absolute right-4 top-8 z-50 flex items-center gap-2">
      {/* Tema — global, sempre visível ao lado do avatar */}
      <ThemeToggle />

      <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu do perfil"
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl',
          'bg-gradient-to-br from-accent-300 to-accent-600 text-[13px] font-bold text-bg-0',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_8px_20px_rgba(0,0,0,0.35)]',
          'transition-transform hover:scale-105 focus:outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent-400/60',
        )}
      >
        {initials}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-[calc(100%+10px)] w-[19rem] origin-top-right rounded-2xl',
            'border border-white/[0.08] bg-bg-1/95 p-2 shadow-elevated',
          )}
          style={{ backdropFilter: 'blur(20px)' }}
        >
          {/* Identidade — nome de exibição (email só quando difere do nome) */}
          <div className="px-3 pb-3 pt-2">
            <p className="truncate text-sm font-semibold text-ink-800">{displayName}</p>
            {user.email && user.email.toLowerCase() !== displayName.toLowerCase() && (
              <p className="mt-0.5 truncate text-xs text-ink-400">{user.email}</p>
            )}
          </div>

          {/* Workspace — agora o container dos canais (recursos do workspace) */}
          <div className="border-t border-white/[0.06] px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">
                Workspace
              </p>
              <span className="rounded-full bg-accent-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-400">
                {planLabel}
              </span>
            </div>

            {multi && (
              <ul className="space-y-0.5">
                {me.data!.workspaces
                  .filter((w) => w.id !== me.data!.activeWorkspaceId)
                  .map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        disabled={switching}
                        onClick={() => activate(w.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm',
                          'text-ink-600 transition-colors hover:bg-white/[0.06] hover:text-ink-800',
                          'disabled:cursor-wait disabled:opacity-50',
                        )}
                      >
                        <span className="min-w-0 truncate">{w.name}</span>
                        <span className="text-[10px] uppercase text-ink-400">{w.role}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}

            {/* Canais do workspace — painel aninhado */}
            <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2">
              <div className="mb-1.5 flex items-center justify-between pl-1.5">
                <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">
                  Canais
                  {totalChannels > 0 && (
                    <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-semibold text-ink-500">
                      {totalChannels}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => navigate('/channels')}
                  aria-label="Adicionar ou gerenciar canais"
                  title="Adicionar ou gerenciar canais"
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-lg text-ink-400',
                    'transition-colors hover:bg-white/[0.06] hover:text-accent-300',
                  )}
                >
                  <IconPlus size={14} />
                </button>
              </div>

              {channels.isLoading ? (
                <p className="px-1.5 py-1 text-xs text-ink-400">carregando…</p>
              ) : totalChannels === 0 ? (
                <button
                  type="button"
                  onClick={() => navigate('/channels')}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-500 transition-colors hover:bg-white/[0.06] hover:text-ink-800"
                >
                  <IconPlus size={13} />
                  Conectar seu primeiro canal
                </button>
              ) : (
                <>
                  <ul
                    role="listbox"
                    aria-label="Canal ativo"
                    className="flex max-h-56 flex-col gap-0.5 overflow-y-auto"
                  >
                    {visibleChannels.map((c) => (
                      <li key={c.id}>
                        <ChannelRow c={c} />
                      </li>
                    ))}
                  </ul>

                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllChannels((v) => !v)}
                      className="mt-0.5 flex w-full items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-ink-500 transition-colors hover:bg-white/[0.06] hover:text-ink-800"
                    >
                      {showAllChannels ? 'Ver menos' : `Ver todos os ${totalChannels} canais`}
                      <IconChevronDown
                        size={12}
                        className={cn('transition-transform', showAllChannels && 'rotate-180')}
                      />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Configurações */}
          <div className="border-t border-white/[0.06] p-1 pt-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => navigate('/settings')}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm',
                'text-ink-600 transition-colors hover:bg-white/[0.06] hover:text-ink-800',
              )}
            >
              <IconSettings size={15} className="opacity-80" />
              Configurações
            </button>
          </div>

          {/* Sair */}
          <div className="border-t border-white/[0.06] p-1 pt-1.5">
            <button
              type="button"
              onClick={logout}
              role="menuitem"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm',
                'text-ink-600 transition-colors hover:bg-white/[0.06] hover:text-err',
              )}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sair
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
