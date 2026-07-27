'use client';

import { useEffect, useRef } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useQueryClient } from '@tanstack/react-query';
import { ensureFreshToken, getToken } from '@/lib/api-client';
import type { ChannelStatusDto } from '@/lib/monitoring-types';
import type { LiveSession } from '@/lib/types';

/**
 * Realtime do status on/off dos canais via SSE — UMA conexão global para o
 * app inteiro (montada no layout do dashboard).
 *
 * Assina `/api/v2/monitoring/stream`, que emite os eventos de domínio
 * `LiveSessionStarted` / `LiveSessionEnded` assim que o handler do EventSub
 * (ou o reconciliador Helix) abre/fecha uma sessão. Em vez de poll de 10s,
 * o badge do picker e o banner de status viram instantâneos.
 *
 * Performance:
 *  - 1 conexão SSE para N canais (filtra por channelId no cliente), não N.
 *  - Update OTIMISTA do cache (setQueryData) → flip imediato do badge sem
 *    round-trip; em seguida invalida pra reconciliar com o servidor
 *    (stale-while-revalidate).
 *  - Os polls que sobraram viram fallback lento (30s) — ver use-channel-status
 *    e o sidebar picker.
 */
interface MonitoringEvent {
  type?: string;
  sessionId?: string;
  channelId?: string;
  startedAt?: string;
  endedAt?: string;
  ping?: number;
}

export function useMonitoringRealtime(): void {
  const qc = useQueryClient();
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    const token = getToken() ?? '';
    if (!token) return; // atrás do AuthGuard, mas guard defensivo

    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;

    // Bypass do proxy do Next (bufferiza SSE). Vai direto na API; o backend
    // libera CORS e o JWT vai na query (evita preflight OPTIONS).
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url = `${apiBase}/api/v2/monitoring/stream?token=${encodeURIComponent(token)}`;

    void fetchEventSource(url, {
      // Token FRESCO a cada (re)conexao: o access de 15min expiraria no meio
      // de streams longos; o refresh rotaciona antes de reconectar.
      fetch: async (input, init) => {
        const fresh = (await ensureFreshToken()) ?? '';
        const u = new URL(String(input), window.location.origin);
        u.searchParams.set('token', fresh);
        return fetch(u.toString(), init);
      },
      signal: c.signal,
      openWhenHidden: true,
      async onopen(resp) {
        if (!resp.ok) throw new Error(`SSE monitoring open failed: ${resp.status}`);
      },
      onmessage(ev) {
        if (!ev.data) return;
        let payload: MonitoringEvent;
        try {
          payload = JSON.parse(ev.data) as MonitoringEvent;
        } catch {
          return;
        }
        if (payload.ping) return;
        const channelId = payload.channelId;
        if (!channelId) return;

        const online = payload.type === 'LiveSessionStarted';
        const offline = payload.type === 'LiveSessionEnded';
        if (!online && !offline) return;

        // Flip otimista do status do canal (instantâneo).
        qc.setQueryData<ChannelStatusDto>(['channel-status', channelId], (prev) => ({
          channelId,
          online,
          currentSession: online
            ? {
                id: payload.sessionId ?? 'live',
                channelId,
                state: 'ACTIVE',
                status: 'ACTIVE',
                startedAt: payload.startedAt ?? new Date().toISOString(),
                endedAt: null,
              }
            : null,
          lastSession: prev?.lastSession ?? null,
        }));

        // Patch otimista da lista de sessões (alimenta o onlineMap do picker).
        qc.setQueryData<LiveSession[]>(['monitoring-sessions'], (prev) => {
          const list = prev ? [...prev] : [];
          const idx = list.findIndex((s) => s.channelId === channelId);
          if (online) {
            const sess: LiveSession = {
              id: payload.sessionId ?? 'live',
              channelId,
              state: 'ACTIVE',
              startedAt: payload.startedAt ?? new Date().toISOString(),
              endedAt: null,
            };
            if (idx >= 0) list[idx] = sess;
            else list.unshift(sess);
          } else {
            const existing = idx >= 0 ? list[idx] : undefined;
            if (existing) {
              list[idx] = {
                ...existing,
                state: 'ENDED',
                endedAt: payload.endedAt ?? new Date().toISOString(),
              };
            }
          }
          return list;
        });

        // Reconcilia com a verdade do servidor.
        void qc.invalidateQueries({ queryKey: ['channel-status', channelId] });
        void qc.invalidateQueries({ queryKey: ['monitoring-sessions'] });
      },
      onerror() {
        // Não relança: fetchEventSource reconecta com backoff automático.
      },
    });

    return () => {
      c.abort();
    };
    // qc é estável durante a vida do app; mantê-lo fora das deps evita
    // reconexão inútil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
