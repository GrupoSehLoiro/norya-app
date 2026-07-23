'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useMe, useEntitlements } from '@/hooks/use-me';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import { api, setToken } from '@/lib/api-client';
import { fetchChannels, fetchSessions } from '@/lib/queries';
import { fmtLimit } from '@/lib/billing';
import { ThemeToggle } from './theme-toggle';
import type { AuthTokensLite } from '@/lib/types';

/**
 * Menu flutuante do perfil (canto superior direito do conteúdo). Absorveu os
 * itens que viviam no Topbar — identidade, workspace (+ troca), tema, sair —
 * e o seletor de CANAL ATIVO, que antes morava na sidebar. O avatar é o único
 * elemento visível; o resto abre sob demanda.
 */
export function ProfileMenu() {
  const { user, logout } = useAuth();
  const me = useMe();
  const ent = useEntitlements();
  const qc = useQueryClient();
  const { channelId, setChannelId } = useSelectedChannel();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
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

  if (!user) return null;

  const initials = (user.username ?? '?')
    .split(/[\s._-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const active = me.data?.workspaces.find((w) => w.id === me.data!.activeWorkspaceId);
  const multi = (me.data?.workspaces.length ?? 0) > 1;
  const planLabel = ent.data?.plan.label ?? active?.planKey ?? 'free';
  const usage = ent.data
    ? `${ent.data.usage.creators}/${fmtLimit(ent.data.limits.maxCreators)} canais`
    : null;

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

  return (
    <div ref={rootRef} className="absolute right-4 top-8 z-50">
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
            'absolute right-0 top-[calc(100%+10px)] w-72 origin-top-right rounded-2xl',
            'border border-white/[0.08] bg-bg-1/95 p-2 shadow-elevated',
          )}
          style={{ backdropFilter: 'blur(20px)' }}
        >
          {/* Identidade */}
          <div className="px-3 pb-3 pt-2">
            <p className="text-sm font-semibold text-ink-800">{user.username}</p>
            <p className="mt-0.5 truncate text-xs text-ink-400">{user.email}</p>
          </div>

          {/* Canal ativo — seleção movida da sidebar pra cá */}
          <div className="border-t border-white/[0.06] px-3 py-3">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">
              Canal ativo
            </p>
            {channels.isLoading ? (
              <p className="text-xs text-ink-400">carregando…</p>
            ) : (channels.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-ink-400">nenhum canal cadastrado</p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {channels.data!.map((c) => {
                  const isActive = c.id === channelId;
                  const isOnline = onlineMap.get(c.id) === true;
                  return (
                    <li key={c.id}>
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
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Workspace ativo + troca */}
          {active && (
            <div className="border-t border-white/[0.06] px-3 py-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">
                Workspace
              </p>
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-ink-800">
                  {active.name}
                </span>
                <span className="rounded-full bg-accent-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-400">
                  {planLabel}
                </span>
              </div>
              {usage && <p className="mt-1 text-xs text-ink-400">{usage}</p>}

              {multi && (
                <ul className="mt-2 space-y-0.5">
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
            </div>
          )}

          {/* Tema */}
          <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2.5">
            <span className="text-sm text-ink-600">Tema</span>
            <ThemeToggle />
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
  );
}
