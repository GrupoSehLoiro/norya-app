'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SparkBars } from '@/components/metrics/spark-bars';
import { PageHeader } from '@/components/layout/page-header';
import { AdminGate } from '@/components/auth/admin-gate';
import { api } from '@/lib/api-client';
import type { Granularity, MetricsSummary } from '@/lib/metrics-types';
import { formatDate, formatPct } from '@/lib/utils';

const RANGES = [
  { label: '1h',  hours: 1,  granularity: 'minute' as Granularity },
  { label: '6h',  hours: 6,  granularity: 'minute' as Granularity },
  { label: '24h', hours: 24, granularity: 'hour'   as Granularity },
  { label: '7d',  hours: 168,granularity: 'hour'   as Granularity },
  { label: '30d', hours: 720,granularity: 'day'    as Granularity },
];

const TIER_LABEL: Record<number, { name: string; tone: 'positive' | 'warn' | 'accent' | 'neutral' }> = {
  0: { name: 'fallback',    tone: 'warn' },
  1: { name: 'heurístico',  tone: 'neutral' },
  2: { name: 'Haiku 4.5',   tone: 'accent' },
  3: { name: 'Sonnet 4.6',  tone: 'positive' },
};

export default function MetricsPage() {
  return (
    <AdminGate>
      <MetricsInner />
    </AdminGate>
  );
}

function MetricsInner() {
  const [rangeIdx, setRangeIdx] = useState(2);
  const range = RANGES[rangeIdx]!;
  // A janela (from/to) precisa ser ESTÁVEL entre renders — senão `to = agora`
  // muda a cada ms, a queryKey churna e a query nunca assenta (loop infinito de
  // "carregando"). Quantizamos `to` ao minuto e memoizamos por range; o
  // `refetchInterval` abaixo cuida da atualização ao vivo na mesma key.
  const { from, to } = useMemo(() => {
    const nowMs = Math.floor(Date.now() / 60_000) * 60_000;
    return {
      from: new Date(nowMs - range.hours * 3_600_000).toISOString(),
      to: new Date(nowMs).toISOString(),
    };
  }, [range.hours]);

  const metrics = useQuery({
    queryKey: ['ai-metrics', from, to, range.granularity],
    queryFn: () => api.get<MetricsSummary>(
      `/api/v2/social-listening/metrics/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=${range.granularity}`,
    ),
    refetchInterval: 30_000,
  });

  const data = metrics.data;

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Observabilidade"
        title="Métricas da IA"
        description="Uso, custo e latência da IA em tempo real. Atualiza a cada 30s."
        actions={
          <div className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.04] p-1">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setRangeIdx(i)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                  i === rangeIdx
                    ? 'bg-gradient-to-br from-accent-300 to-accent-500 text-bg-0'
                    : 'text-ink-600 hover:bg-white/[0.07] hover:text-ink-800'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {metrics.isLoading ? (
        <Card>carregando métricas…</Card>
      ) : metrics.error ? (
        <Card className="border-err/30 bg-err/[0.08] text-err">
          Falha ao buscar métricas: {(metrics.error as Error).message}
        </Card>
      ) : !data ? null : (
        <>
          <KpiCards data={data} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                eyebrow="Volume"
                title="Batches ao longo do tempo"
                description={`${data.timeseries.length} pontos · granularidade: ${data.range.granularity}`}
              />
              <SparkBars
                values={data.timeseries.map((p) => p.batches)}
                labels={data.timeseries.map((p) => p.bucket)}
                color="var(--pal-amber)"
                height={120}
              />
            </Card>
            <Card>
              <CardHeader eyebrow="Throughput" title="Mensagens processadas" />
              <SparkBars
                values={data.timeseries.map((p) => p.messages)}
                labels={data.timeseries.map((p) => `${p.bucket}: ${p.messages} msgs`)}
                color="#6ee7b7"
                height={120}
              />
            </Card>
            <Card>
              <CardHeader eyebrow="Latência" title="ms médios" />
              <SparkBars
                values={data.timeseries.map((p) => p.avgLatencyMs)}
                labels={data.timeseries.map((p) => `${p.bucket}: ${p.avgLatencyMs.toFixed(0)}ms`)}
                color="#fbbf24"
                height={120}
              />
            </Card>
            <Card>
              <CardHeader eyebrow="Custo" title="USD por bucket" />
              <SparkBars
                values={data.timeseries.map((p) => p.costUsd)}
                labels={data.timeseries.map((p) => `${p.bucket}: $${p.costUsd.toFixed(6)}`)}
                color="#f87171"
                height={120}
              />
            </Card>
            <Card>
              <CardHeader eyebrow="Qualidade" title="Confidence média" />
              <SparkBars
                values={data.timeseries.map((p) => p.avgConfidence)}
                labels={data.timeseries.map((p) => `${p.bucket}: ${formatPct(p.avgConfidence)}`)}
                color="#a78bfa"
                height={120}
              />
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader eyebrow="Distribuição" title="Por tier" />
              {data.byTier.length === 0 ? (
                <p className="text-sm text-ink-400">sem dados na janela</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.byTier.map((row) => {
                    const meta = TIER_LABEL[row.tier] ?? { name: `T${row.tier}`, tone: 'neutral' as const };
                    const total = data.totals.batches || 1;
                    const pct = (row.count / total) * 100;
                    return (
                      <li key={row.tier}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge tone={meta.tone}>T{row.tier} · {meta.name}</Badge>
                            <span className="text-ink-600">{row.count} batches</span>
                          </div>
                          <span className="text-ink-400">${row.costUsd.toFixed(6)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full bg-gradient-to-r from-accent-400 to-accent-600" style={{ width: `${pct}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader eyebrow="Mix" title="Por modelo" />
              {data.byModel.length === 0 ? (
                <p className="text-sm text-ink-400">sem dados</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-left text-[10px] uppercase tracking-[0.14em] text-ink-400">
                      <th className="pb-2 pr-4 font-medium">Modelo</th>
                      <th className="pb-2 pr-4 text-right font-medium">Batches</th>
                      <th className="pb-2 pr-4 text-right font-medium">Latência</th>
                      <th className="pb-2 pr-4 text-right font-medium">Custo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={m.model} className="border-b border-white/[0.05] last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{m.model}</td>
                        <td className="py-2 pr-4 text-right">{m.count}</td>
                        <td className="py-2 pr-4 text-right text-ink-400">
                          {m.avgLatencyMs.toFixed(0)} ms
                        </td>
                        <td className="py-2 pr-4 text-right">${m.costUsd.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader
              eyebrow="Canais"
              title="Custo por canal (top 15)"
              description="Ordenado por gasto USD na janela."
            />
            {data.byChannel.length === 0 ? (
              <EmptyState title="Sem batches no período" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-left text-[10px] uppercase tracking-[0.14em] text-ink-400">
                      <th className="pb-2 pr-4 font-medium">Canal</th>
                      <th className="pb-2 pr-4 text-right font-medium">Batches</th>
                      <th className="pb-2 pr-4 text-right font-medium">Msgs</th>
                      <th className="pb-2 pr-4 text-right font-medium">Custo (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byChannel.map((c) => (
                      <tr key={c.channelId} className="border-b border-white/[0.05] last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{c.channelId}</td>
                        <td className="py-2 pr-4 text-right">{c.batches}</td>
                        <td className="py-2 pr-4 text-right">{c.messages}</td>
                        <td className="py-2 pr-4 text-right">${c.costUsd.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-xs text-ink-400">
            Janela: {formatDate(data.range.from)} → {formatDate(data.range.to)} ·
            granularidade {data.range.granularity}
          </p>
        </>
      )}
    </div>
  );
}

function KpiCards({ data }: { data: MetricsSummary }) {
  const cacheTarget = 0.8;
  const cacheTone =
    data.cacheHitRateAvg >= cacheTarget ? 'positive' :
    data.cacheHitRateAvg > 0 ? 'warn' : 'neutral';
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label="Batches" value={data.totals.batches.toLocaleString('pt-BR')} />
      <Kpi label="Mensagens" value={data.totals.messages.toLocaleString('pt-BR')} hint={`${data.totals.messagesWeighted.toLocaleString('pt-BR')} c/ peso`} />
      <Kpi label="Canais ativos" value={String(data.totals.activeChannels)} />
      <Kpi label="Custo (USD)" value={`$${data.totals.costUsd.toFixed(4)}`} hint={data.totals.costUsd === 0 ? 'mock (zero)' : 'real'} />
      <Kpi label="Latência p95" value={`${data.latency.p95Ms.toFixed(0)} ms`} hint={`p50 ${data.latency.p50Ms.toFixed(0)} · p99 ${data.latency.p99Ms.toFixed(0)}`} />
      <div className="glass-card">
        <p className="eyebrow">Cache hit (tier-2)</p>
        <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">
          {formatPct(data.cacheHitRateAvg)}
        </p>
        <div className="mt-3">
          <Badge tone={cacheTone}>alvo &gt; {formatPct(cacheTarget, 0)}</Badge>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-card">
      <p className="eyebrow">{label}</p>
      <p className="mt-3 text-3xl font-bold tracking-tight text-ink-800">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}
