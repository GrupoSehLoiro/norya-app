'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { SseIndicator } from '@/components/ui/sse-indicator';
import { useChannelStatus } from '@/hooks/use-channel-status';
import { useSseInsights } from '@/hooks/use-sse-insights';
import { fetchBatchInsight } from '@/lib/analytics';
import { api } from '@/lib/api-client';
import type { BatchAnalysis, InsightsHistoryResponse } from '@/lib/types';
import { classifySentiment, formatDate, formatPct, formatRelative } from '@/lib/utils';

const STATUS_TONE = {
  idle: 'neutral',
  connecting: 'neutral',
  open: 'positive',
  closed: 'neutral',
  error: 'negative',
} as const;

export function LiveFeed({ channelId }: { channelId: string | null }) {
  const { status, events, lastPing, error } = useSseInsights(channelId);
  // "Conectado" (transporte SSE) ≠ "ao vivo" (live real): o badge verde só
  // acende com a live rolando; SSE aberto com canal offline vira "aguardando
  // live" — senão o card parece live com o canal fora do ar.
  const channelStatus = useChannelStatus(channelId);
  const channelOnline = channelStatus.data?.online === true;
  const [openId, setOpenId] = useState<string | null>(null);

  // Lastro persistido: histórico recente de batches (ClickHouse via REST). O
  // cache do react-query sobrevive a remontagem/reconexão do SSE, então o feed
  // não "some" e agrega de verdade. O SSE só prependa os blocos novos ao vivo.
  const history = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-history', channelId, 'feed'],
    queryFn: () =>
      api.get<InsightsHistoryResponse>(
        `/api/v2/social-listening/insights/history?channelId=${encodeURIComponent(channelId!)}&limit=40`,
      ),
    refetchInterval: 15_000,
  });

  // Merge SSE (ao vivo) + histórico (persistido), dedup por batchId, mais recente primeiro.
  const merged = useMemo<BatchAnalysis[]>(() => {
    const byId = new Map<string, BatchAnalysis>();
    for (const b of history.data?.items ?? []) byId.set(b.batchId, b);
    for (const b of events) byId.set(b.batchId, b); // SSE sobrescreve (mais fresco)
    return [...byId.values()]
      .sort((a, b) => new Date(b.windowStart).getTime() - new Date(a.windowStart).getTime())
      .slice(0, 50);
  }, [history.data, events]);

  return (
    <div className="glass-card flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">SSE live</p>
          <h2 className="text-base font-semibold text-ink-800">Feed ao vivo</h2>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {status === 'open' ? (
            channelOnline ? (
              <SseIndicator>ao vivo</SseIndicator>
            ) : (
              <Badge tone="neutral">aguardando live</Badge>
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

      {merged.length === 0 ? (
        <p className="my-auto text-center text-sm text-ink-400">
          {status !== 'open'
            ? 'Selecione um canal ativo para receber insights ao vivo.'
            : channelOnline
            ? 'Ao vivo — aguardando o primeiro batch do orchestrator…'
            : 'Canal offline — o feed retoma automaticamente quando a live abrir.'}
        </p>
      ) : (
        <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {merged.map((e) => {
            const s = classifySentiment(e.climaGeral);
            const open = openId === e.batchId;
            return (
              <li
                key={e.batchId}
                className="rounded-xl border border-white/[0.06] bg-white/[0.025] text-sm"
              >
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : e.batchId)}
                  className="w-full p-3 text-left transition-colors hover:bg-white/[0.05] rounded-xl"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-ink-700">{formatDate(e.windowStart)}</span>
                    <Badge tone={s.label === 'positivo' ? 'positive' : s.label === 'negativo' ? 'negative' : 'neutral'}>
                      {s.label}
                    </Badge>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1 text-xs text-ink-600 md:grid-cols-4">
                    <span>msgs <b className="text-ink-800">{e.messageCount}</b></span>
                    <span>users <b className="text-ink-800">{e.uniqueUsers}</b></span>
                    <span>pos <b className="text-ok">{formatPct(e.climaGeral.pos)}</b></span>
                    <span>neg <b className="text-err">{formatPct(e.climaGeral.neg)}</b></span>
                  </div>
                  <p className="mt-1 flex items-center justify-between truncate text-xs text-ink-400">
                    <span>pauta: {e.pautaMaisComentada?.category ?? '—'}</span>
                    <span className="text-accent-400">{open ? 'fechar ▲' : 'insight ▾'}</span>
                  </p>
                </button>
                {open && <BatchInsightBlock batchId={e.batchId} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BatchInsightBlock({ batchId }: { batchId: string }) {
  const q = useQuery({
    queryKey: ['batch-insight', batchId],
    queryFn: () => fetchBatchInsight(batchId),
    staleTime: 5 * 60_000,
  });
  return (
    <div className="border-t border-white/[0.06] px-3 py-2.5">
      {q.isLoading ? (
        <p className="text-xs text-ink-400">gerando insight…</p>
      ) : q.isError ? (
        <p className="text-xs text-err">Falha ao gerar insight.</p>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink-700">{q.data!.insight}</p>
          <p className="mt-1.5 text-[10px] uppercase tracking-wide text-ink-400">
            {q.data!.messageCount} msgs · {q.data!.aiEnabled ? 'via Haiku' : 'sem IA (ative LLM_DRIVER=real)'}
          </p>
        </>
      )}
    </div>
  );
}
