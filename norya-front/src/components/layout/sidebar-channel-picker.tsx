'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { fetchChannels, fetchSessions } from '@/lib/queries';
import { useSelectedChannel } from '@/hooks/use-selected-channel';

/**
 * Picker do canal monitorado, sticky no topo da sidebar. Persiste a
 * seleção via `useSelectedChannel` (localStorage). Dropdown custom
 * com estética glass — não usa `<select>` nativo pra não herdar o
 * chrome do navegador.
 */
export function SidebarChannelPicker() {
  const { channelId, setChannelId } = useSelectedChannel();
  const { data, isLoading } = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
    // Canal desconectado (active=false, ex.: disconnect na página de
    // integrações) sai do picker na hora.
    select: (xs) => xs.filter((c) => c.active !== false),
  });
  const sessions = useQuery({
    queryKey: ['monitoring-sessions'],
    queryFn: fetchSessions,
    // Fallback — o realtime via SSE (use-monitoring-realtime) já empurra os
    // flips de online/offline no cache instantaneamente; 10s limita o pior caso.
    refetchInterval: 10_000,
  });
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Auto-seleciona o canal do usuário pós-onboarding: se nada está escolhido
  // (ou a seleção salva não pertence mais a este workspace), assume o 1º canal.
  useEffect(() => {
    if (!data || data.length === 0) return;
    const valid = channelId && data.some((c) => c.id === channelId);
    if (!valid) setChannelId(data[0]!.id);
  }, [data, channelId, setChannelId]);

  // Map channelId → boolean (true = tem sessão ACTIVE = canal está ao vivo).
  const onlineMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sessions.data ?? []) {
      if (s.state === 'ACTIVE') m.set(s.channelId, true);
    }
    return m;
  }, [sessions.data]);

  // Click-outside fecha o painel.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = data?.find((c) => c.id === channelId) ?? null;
  const selectedOnline = selected ? onlineMap.get(selected.id) === true : false;

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-400">
        Canal ativo
      </p>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'group flex w-full items-center justify-between gap-2 rounded-lg',
          'border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-left text-sm',
          'transition-colors hover:bg-white/[0.07] hover:border-white/[0.14]',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 leading-none">
          <span
            className={cn(
              'inline-block h-2 w-2 flex-shrink-0 rounded-full',
              !selected
                ? 'bg-white/30'
                : selectedOnline
                ? 'bg-ok shadow-[0_0_0_3px_rgba(110,231,183,0.18)]'
                : 'bg-err shadow-[0_0_0_3px_rgba(248,113,113,0.18)]',
            )}
            aria-hidden
          />
          {selected ? (
            <span className="truncate font-medium leading-none text-ink-800">
              {selected.name}
            </span>
          ) : (
            <span className="truncate leading-none text-ink-400">
              {isLoading ? 'carregando…' : 'selecionar canal'}
            </span>
          )}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1.5">
          {selected ? (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.10em]',
                selected.platform === 'twitch'
                  ? 'bg-platform-twitch/15 text-platform-twitch'
                  : 'bg-platform-kick/15 text-platform-kick',
              )}
            >
              {selected.platform}
            </span>
          ) : null}
          <svg
            className={cn('text-ink-400 transition-transform', open && 'rotate-180')}
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute left-0 right-0 top-full z-40 mt-2',
            'glass-surface max-h-72 overflow-y-auto p-1.5',
          )}
        >
          {isLoading ? (
            <p className="px-3 py-2 text-xs text-ink-400">carregando…</p>
          ) : (data?.length ?? 0) === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-400">nenhum canal cadastrado</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {data?.map((c) => {
                const active = c.id === channelId;
                const isOnline = onlineMap.get(c.id) === true;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setChannelId(c.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px]',
                        'transition-colors ease-glass',
                        active
                          ? 'bg-gradient-to-br from-accent-300 to-accent-400 text-bg-0'
                          : 'text-ink-700 hover:bg-white/[0.06] hover:text-ink-800',
                      )}
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2 leading-none">
                        <span
                          className={cn(
                            'inline-block h-2 w-2 flex-shrink-0 rounded-full',
                            active
                              ? 'bg-bg-0'
                              : isOnline
                              ? 'bg-ok'
                              : 'bg-err',
                          )}
                          aria-hidden
                        />
                        <span className="truncate font-medium leading-none">{c.name}</span>
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.10em]',
                          active
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
      )}
    </div>
  );
}
