'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { ensureFreshToken, getToken } from '@/lib/api-client';
import type { MessageHit } from '@/lib/analytics';

interface LiveChatState {
  status: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
  /** Acumulado das mensagens recebidas (backfill + ao vivo), com cap. */
  messages: MessageHit[];
  lastPing: number | null;
  error: string | null;
}

// Cap generoso: o LiveFeed dedup/enfileira; isto é só o buffer de transporte.
const MAX_MESSAGES = 600;

/**
 * Assina o SSE de chat CRU `/api/v2/social-listening/stream/:channelId/chat`.
 *
 * Cada evento é um `MessageHit` (mensagem individual em tempo real, sem passar
 * pelo batch) OU `{ ping }`. Ao conectar, o backend faz backfill das últimas
 * mensagens do buffer. Substitui o polling REST de 8s do feed antigo.
 */
export function useLiveChat(channelId: string | null): LiveChatState {
  const [state, setState] = useState<LiveChatState>({
    status: 'idle', messages: [], lastPing: null, error: null,
  });
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!channelId) {
      setState({ status: 'idle', messages: [], lastPing: null, error: null });
      return;
    }

    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState({ status: 'connecting', messages: [], lastPing: null, error: null });

    const token = getToken() ?? '';
    // Mesmo bypass do Next rewrite do use-sse-insights: vai direto na API
    // (o proxy do Next bufferiza chunks de SSE e quebra o fetch-event-source).
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    const url =
      `${apiBase}/api/v2/social-listening/stream/${encodeURIComponent(channelId)}/chat` +
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
          throw new Error(`SSE chat open failed: ${resp.status}`);
        }
      },
      onmessage(ev) {
        if (!ev.data) return;
        try {
          const payload = JSON.parse(ev.data) as MessageHit | { ping: number };
          if ('ping' in payload) {
            setState((s) => ({ ...s, lastPing: payload.ping }));
            return;
          }
          setState((s) => ({
            ...s,
            messages: [...s.messages, payload as MessageHit].slice(-MAX_MESSAGES),
          }));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('live-chat SSE parse failed', err);
        }
      },
      onerror(err) {
        setState((s) => ({ ...s, status: 'error', error: String(err) }));
        // não relança — fetchEventSource reconecta com backoff
      },
      onclose() {
        setState((s) => ({ ...s, status: 'closed' }));
      },
    });

    return () => { c.abort(); };
  }, [channelId]);

  return state;
}
