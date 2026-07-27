'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useQueryClient } from '@tanstack/react-query';
import { ensureFreshToken, getToken } from '@/lib/api-client';
import type { BatchAnalysis, SseInsightMessage } from '@/lib/types';

interface SseState {
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  events: BatchAnalysis[];
  lastPing: number | null;
  error: string | null;
}

const MAX_EVENTS = 50;

/**
 * Assina o SSE `/api/v2/social-listening/stream/:channelId` usando
 * `fetchEventSource` (header Authorization). Mantém um buffer in-memory
 * dos últimos N eventos.
 */
export function useSseInsights(channelId: string | null): SseState {
  const [state, setState] = useState<SseState>({
    status: 'idle', events: [], lastPing: null, error: null,
  });
  const ctrl = useRef<AbortController | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!channelId) {
      setState({ status: 'idle', events: [], lastPing: null, error: null });
      return;
    }

    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ ...s, status: 'connecting', error: null }));

    const token = getToken() ?? '';
    // Bypass do Next.js rewrite: o proxy do Next bufferiza chunks de SSE
    // e o fetch-event-source explode com "Error in input stream". Vai
    // direto na API (CORS_ORIGIN do backend libera localhost:3000) e
    // passa o JWT na query (evita preflight OPTIONS).
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url =
      `${apiBase}/api/v2/social-listening/stream/${encodeURIComponent(channelId)}` +
      `?token=${encodeURIComponent(token)}`;

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
        if (resp.ok) {
          setState((s) => ({ ...s, status: 'open' }));
        } else {
          setState((s) => ({ ...s, status: 'error', error: `HTTP ${resp.status}` }));
          throw new Error(`SSE open failed: ${resp.status}`);
        }
      },
      onmessage(ev) {
        if (!ev.data) return;
        try {
          const payload = JSON.parse(ev.data) as SseInsightMessage;
          if ('ping' in payload) {
            setState((s) => ({ ...s, lastPing: payload.ping }));
            return;
          }
          setState((s) => ({
            ...s,
            events: [payload, ...s.events].slice(0, MAX_EVENTS),
          }));
          // Empurra a chegada de um novo batch pras outras views da page —
          // gráfico de atividade, agregado de marcas mencionadas, etc.
          // O prefix-match do invalidateQueries cobre as duas variações:
          //   ['insights-history', channelId]                  (page)
          //   ['insights-history', channelId, 'chart', limit]  (chart)
          void qc.invalidateQueries({ queryKey: ['insights-history', channelId] });
          void qc.invalidateQueries({ queryKey: ['insights-latest', channelId] });
        } catch (err) {
          // payload corrompido — ignora silenciosamente
          // eslint-disable-next-line no-console
          console.warn('SSE parse failed', err);
        }
      },
      onerror(err) {
        setState((s) => ({ ...s, status: 'error', error: String(err) }));
        // Não retornamos — fetchEventSource tenta reconectar com backoff.
      },
      onclose() {
        setState((s) => ({ ...s, status: 'closed' }));
      },
    });

    return () => { c.abort(); };
    // `qc` é estável (mesma instância do QueryClient durante a vida do app),
    // por isso não entra nas deps — incluí-lo causaria reconnect inútil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  return state;
}
