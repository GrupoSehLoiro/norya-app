'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { SseIndicator } from '@/components/ui/sse-indicator';
import { useChannelStatus } from '@/hooks/use-channel-status';
import { useSseInsights } from '@/hooks/use-sse-insights';
import { searchMessages, type MessageHit } from '@/lib/analytics';
import { formatRelative } from '@/lib/utils';

const STATUS_TONE = {
  idle: 'neutral',
  connecting: 'neutral',
  open: 'positive',
  closed: 'neutral',
  error: 'negative',
} as const;

const DOT: Record<'pos' | 'neu' | 'neg', string> = {
  pos: 'bg-ok',
  neu: 'bg-white/30',
  neg: 'bg-err',
};

function sentimentOf(s: string): 'pos' | 'neu' | 'neg' {
  if (s === 'positive') return 'pos';
  if (s === 'negative') return 'neg';
  return 'neu';
}

// Cor por usuário, como no chat da Twitch: determinística pelo username,
// paleta calibrada pra legibilidade no fundo escuro.
const NAME_COLORS = [
  '#ff8a8a', // coral
  '#7cc4ff', // azul céu
  '#8ee08e', // verde
  '#ffb46b', // laranja
  '#c9a2ff', // lilás
  '#6fe0cb', // turquesa
  '#ff9ed2', // rosa
  '#ffd76e', // âmbar
  '#9db8ff', // azul lavanda
  '#b8e986', // lima
];

function nameColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(h) % NAME_COLORS.length] ?? '#8ee08e';
}

function ts(m: MessageHit): number {
  const t = new Date(m.receivedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const WINDOW_MS = 6 * 60 * 60 * 1000; // janela de busca (6h) — atual e por página de histórico
const POLL_MS = 8_000; // poll curto: menos espera entre o flush do batch e o replay na tela

/**
 * Feed ao vivo — chat real do canal, no comportamento de um chat de live:
 *
 *  - Só mensagens que realmente chegaram; se a live parou, ficam as últimas.
 *  - Mensagens novas entram AOS POUCOS por baixo, empurrando as antigas para
 *    cima (fila de exibição gradual — um lote de 100 não "estoura" de uma vez).
 *  - Barra de rolagem interna; rolar até o topo puxa o histórico anterior.
 *  - Colado no fim = acompanha sozinho; rolou pra cima = posição preservada.
 */
export function LiveFeed({ channelId }: { channelId: string | null }) {
  const { status, lastPing, error } = useSseInsights(channelId);
  const channelStatus = useChannelStatus(channelId);
  const channelOnline = channelStatus.data?.online === true;

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

  // Poll das mensagens recentes (últimas 6h) — só o que realmente chegou.
  const latest = useQuery({
    enabled: !!channelId,
    queryKey: ['live-feed-latest', channelId],
    queryFn: () => {
      const to = new Date();
      const from = new Date(to.getTime() - WINDOW_MS);
      return searchMessages(channelId!, '', from.toISOString(), to.toISOString());
    },
    refetchInterval: POLL_MS,
  });

  // Novas mensagens: só a PRIMEIRA resposta com histórico entra direto (é
  // backdrop, sem animação). Tudo que chega depois — inclusive o primeiro
  // flush de uma live recém-começada — entra na fila e pinga aos poucos.
  useEffect(() => {
    const items = latest.data?.items;
    if (!items) return;
    const isBoot = !bootedRef.current;
    bootedRef.current = true; // mesmo vazia, a 1ª resposta consome o boot
    const fresh = items
      .filter((m) => !seenRef.current.has(m.messageId))
      .sort((a, b) => ts(a) - ts(b));
    if (fresh.length === 0) return;
    for (const m of fresh) seenRef.current.add(m.messageId);
    if (isBoot) {
      setDisplayed(fresh);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      return;
    }
    queueRef.current.push(...fresh);
  }, [latest.data]);

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
    <div className="glass-card flex h-[34rem] flex-col">
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
            ? 'Ao vivo — aguardando as primeiras mensagens…'
            : 'Sem mensagens recentes — o feed retoma quando o chat voltar a falar.'}
        </p>
      ) : (
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto pr-2"
        >
          {noMore && (
            <p className="pb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-ink-400/50">
              início do histórico
            </p>
          )}
          <ul className="flex min-h-full flex-col justify-end gap-2.5">
            {list.map((m) => (
              <li
                key={m.messageId}
                className={`${liveIdsRef.current.has(m.messageId) ? 'msg-in ' : ''}flex w-fit max-w-full items-center gap-2.5 rounded-2xl rounded-bl-sm border border-white/[0.05] bg-white/[0.02] px-4 py-2.5 text-[13.5px]`}
              >
                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[sentimentOf(m.sentiment)]}`} />
                <span className="chat-name flex-shrink-0 font-semibold" style={{ color: nameColor(m.username) }}>
                  {m.username}
                </span>
                <span className="min-w-0 break-words text-ink-500">{m.text}</span>
              </li>
            ))}
          </ul>

          <style jsx>{`
            /* paleta dos usernames é calibrada pro escuro; no claro, escurece */
            :global(html.light) .chat-name {
              filter: brightness(0.55) saturate(1.4);
            }
            /* mesmo easing do pin-in do /landing — chegada suave, sem estouro */
            .msg-in {
              animation: msg-in 480ms cubic-bezier(0.22, 1, 0.36, 1);
            }
            @keyframes msg-in {
              from {
                opacity: 0;
                transform: translateY(14px) scale(0.97);
              }
              to {
                opacity: 1;
                transform: translateY(0) scale(1);
              }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}
