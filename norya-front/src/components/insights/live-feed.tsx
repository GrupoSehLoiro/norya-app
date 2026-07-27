'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { SseIndicator } from '@/components/ui/sse-indicator';
import { useChannelStatus } from '@/hooks/use-channel-status';
import { useChannelEmotes } from '@/hooks/use-channel-emotes';
import { useSseInsights } from '@/hooks/use-sse-insights';
import { useLiveChat } from '@/hooks/use-live-chat';
import { ChatLine, ChatSkinStyles } from '@/components/ui/chat-skin';
import { searchMessages, type MessageHit } from '@/lib/analytics';
import { fetchChannels } from '@/lib/queries';
import { formatRelative } from '@/lib/utils';

const STATUS_TONE = {
  idle: 'neutral',
  connecting: 'neutral',
  open: 'positive',
  closed: 'neutral',
  error: 'negative',
} as const;

function ts(m: MessageHit): number {
  const t = new Date(m.receivedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const WINDOW_MS = 6 * 60 * 60 * 1000; // janela de busca (6h) — histórico inicial e por página

/**
 * Feed ao vivo — chat CRU do canal, em tempo real, no comportamento da Twitch:
 *
 *  - Cada mensagem chega msg-a-msg via SSE (`/stream/:channelId/chat`), sem
 *    esperar o batch. O backend faz backfill das últimas ~60s ao conectar.
 *  - O histórico inicial (antes do backfill) vem de uma busca única em
 *    batch_messages; rolar até o topo puxa mais páginas antigas.
 *  - Mensagens novas entram AOS POUCOS por baixo, empurrando as antigas para
 *    cima (fila de exibição gradual — uma rajada não "estoura" de uma vez).
 *  - Colado no fim = acompanha sozinho; rolou pra cima = posição preservada.
 */
export function LiveFeed({ channelId }: { channelId: string | null }) {
  // Mantém a invalidação dos gráficos (insights-history/latest) viva; o status
  // e as mensagens do feed vêm do SSE de chat cru abaixo.
  useSseInsights(channelId);
  const { status, lastPing, error, messages: liveMessages } = useLiveChat(channelId);
  const channelStatus = useChannelStatus(channelId);
  const emotes = useChannelEmotes(channelId);
  const channelOnline = channelStatus.data?.online === true;

  // Plataforma do canal selecionado → skin do chat (Twitch ou Kick). Reusa o
  // cache da lista do ChannelPicker (mesma queryKey).
  const channelsQ = useQuery({
    queryKey: ['channels-v2'],
    queryFn: fetchChannels,
    staleTime: 60_000,
  });
  const platform: 'twitch' | 'kick' =
    channelsQ.data?.find((c) => c.id === channelId)?.platform === 'kick' ? 'kick' : 'twitch';

  // Mensagens exibidas (ascendente: antiga → nova) + fila de entrada gradual.
  const [displayed, setDisplayed] = useState<MessageHit[]>([]);
  const [noMore, setNoMore] = useState(false);
  const queueRef = useRef<MessageHit[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const liveIdsRef = useRef<Set<string>>(new Set());
  const bootedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prependDeltaRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);

  // Reset ao trocar de canal.
  useEffect(() => {
    setDisplayed([]);
    setNoMore(false);
    queueRef.current = [];
    seenRef.current = new Set();
    liveIdsRef.current = new Set();
    bootedRef.current = false;
  }, [channelId]);

  // Histórico inicial (últimas 6h): busca ÚNICA em batch_messages só pra
  // preencher a tela quando o feed abre. O tempo real vem do SSE, não daqui —
  // por isso sem refetchInterval.
  const latest = useQuery({
    enabled: !!channelId,
    queryKey: ['live-feed-latest', channelId],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_MS);
      return searchMessages(channelId!, '', from.toISOString(), to.toISOString());
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  // Boot do histórico: a 1ª resposta é prependada (é mais antiga que qualquer
  // mensagem ao vivo que já tenha entrado pelo SSE). Sem animação — é backdrop.
  useEffect(() => {
    const items = latest.data?.items;
    if (!items || bootedRef.current) return;
    bootedRef.current = true;
    const fresh = items
      .filter((m) => !seenRef.current.has(m.messageId))
      .sort((a, b) => ts(a) - ts(b));
    if (fresh.length === 0) return;
    for (const m of fresh) seenRef.current.add(m.messageId);
    const el = scrollRef.current;
    // Se o usuário já rolou pra ler, preserva a posição ao prepend; senão cola no fim.
    prependDeltaRef.current = el && !atBottomRef.current ? el.scrollHeight - el.scrollTop : null;
    setDisplayed((prev) => [...fresh, ...prev]);
    if (prependDeltaRef.current === null) {
      requestAnimationFrame(() => {
        const e = scrollRef.current;
        if (e) e.scrollTop = e.scrollHeight;
      });
    }
  }, [latest.data]);

  // Tempo real: cada mensagem do SSE (backfill + ao vivo) entra na fila de
  // exibição gradual. Dedup por messageId cobre a sobreposição com o histórico.
  useEffect(() => {
    if (liveMessages.length === 0) return;
    const fresh = liveMessages
      .filter((m) => !seenRef.current.has(m.messageId))
      .sort((a, b) => ts(a) - ts(b));
    if (fresh.length === 0) return;
    for (const m of fresh) seenRef.current.add(m.messageId);
    queueRef.current.push(...fresh);
  }, [liveMessages]);

  // Drenagem da fila: replay no ritmo REAL do chat — o intervalo entre uma
  // mensagem e a próxima na tela segue o intervalo dos timestamps em que elas
  // chegaram na Twitch. Rajada aparece como rajada, pausa como pausa. Quando a
  // fila acumula (lote grande, chat rápido), o replay acelera em fast-forward
  // progressivo para nunca ficar para trás — mas nunca despeja em bloco.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      const q = queueRef.current;
      if (q.length === 0) {
        timer = setTimeout(tick, 150);
        return;
      }
      const next = q.shift()!;
      liveIdsRef.current.add(next.messageId);
      setDisplayed((prev) => [...prev, next]);
      let delay = 320; // fallback: última da fila, sem próxima como referência
      if (q.length > 0) {
        const gap = ts(q[0]!) - ts(next);
        const factor = q.length > 60 ? 0.15 : q.length > 30 ? 0.3 : q.length > 12 ? 0.6 : 1;
        delay = Math.max(70, Math.min(1600, Math.round(gap * factor)));
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Auto-acompanhar quando o usuário está colado no fim.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependDeltaRef.current !== null) {
      // Histórico prependado: preserva a posição visual.
      el.scrollTop = el.scrollHeight - prependDeltaRef.current;
      prependDeltaRef.current = null;
      return;
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayed]);

  // Rolar até o topo → puxa a página anterior do histórico.
  const loadOlder = useCallback(async () => {
    if (!channelId || loadingOlderRef.current || noMore) return;
    const oldest = displayed[0];
    if (!oldest) return;
    loadingOlderRef.current = true;
    try {
      const to = new Date(ts(oldest));
      const from = new Date(to.getTime() - WINDOW_MS);
      const res = await searchMessages(channelId, '', from.toISOString(), to.toISOString());
      const older = res.items
        .filter((m) => !seenRef.current.has(m.messageId))
        .sort((a, b) => ts(a) - ts(b));
      if (older.length === 0) {
        setNoMore(true);
        return;
      }
      for (const m of older) seenRef.current.add(m.messageId);
      const el = scrollRef.current;
      prependDeltaRef.current = el ? el.scrollHeight - el.scrollTop : null;
      setDisplayed((prev) => [...older, ...prev]);
    } finally {
      loadingOlderRef.current = false;
    }
  }, [channelId, displayed, noMore]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (el.scrollTop < 60) void loadOlder();
  }

  const empty = displayed.length === 0;
  const list = useMemo(() => displayed, [displayed]);

  return (
    <div className="glass-card flex h-[34rem] flex-col outline outline-1 -outline-offset-1 outline-pal-orchid-line">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">Ao vivo</p>
          <h2 className="text-base font-semibold text-ink-800">Feed ao vivo</h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {status === 'open' ? (
            channelOnline ? (
              <SseIndicator>ao vivo</SseIndicator>
            ) : (
              <Badge tone="neutral">últimas mensagens</Badge>
            )
          ) : (
            <Badge tone={STATUS_TONE[status]}>{status}</Badge>
          )}
        </div>
      </div>

      {lastPing ? (
        <p className="mb-2 text-[11px] text-ink-400">
          último ping {formatRelative(new Date(lastPing))}
        </p>
      ) : null}

      {error && <p className="mb-3 text-xs text-err">{error}</p>}

      {empty ? (
        <p className="my-auto text-center text-sm text-ink-400">
          {latest.isLoading
            ? 'carregando o chat…'
            : channelOnline
            ? 'Ao vivo, aguardando as primeiras mensagens…'
            : 'Sem mensagens recentes. O feed retoma quando o chat voltar a falar.'}
        </p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={`chat-skin skin-${platform} min-h-0 flex-1 overflow-y-auto rounded-xl px-2 py-2`}
        >
          {noMore && (
            <p className="pb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] opacity-40">
              início do histórico
            </p>
          )}
          <ul className="flex min-h-full flex-col justify-end">
            {list.map((m) => (
              <ChatLine
                key={m.messageId}
                m={m}
                platform={platform}
                emotes={emotes}
                className={liveIdsRef.current.has(m.messageId) ? 'msg-in' : undefined}
              />
            ))}
          </ul>

          <ChatSkinStyles />
        </div>
      )}
    </div>
  );
}
