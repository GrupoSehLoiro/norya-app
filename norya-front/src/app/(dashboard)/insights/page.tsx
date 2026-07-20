'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ChannelStatusBanner } from '@/components/insights/channel-status-banner';
import { InsightCards } from '@/components/insights/insight-cards';
import { LiveFeed } from '@/components/insights/live-feed';
import { ChatTopicsPanel } from '@/components/insights/chat-topics-panel';
import { ActivityAreaChart } from '@/components/insights/activity-area-chart';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api-client';
import { fetchInsightsSummary } from '@/lib/analytics';
import { dayBoundsIso, shiftYmd, todayYmd } from '@/lib/day-range';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import type { BatchAnalysis, InsightsLatestResponse, InsightsHistoryResponse } from '@/lib/types';

export default function InsightsPage() {
  const { channelId } = useSelectedChannel();

  // Período selecionado (dia) + modo ao vivo — compartilhados por gráfico,
  // boxes, palavras-chave, assuntos e marcas.
  const [date, setDate] = useState<string>(todayYmd());
  const [live, setLive] = useState(true);
  const { from, to } = useMemo(() => dayBoundsIso(date), [date]);
  const isToday = date === todayYmd();
  const refetch = live && isToday ? 15_000 : false;

  const latest = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-latest', channelId],
    queryFn: () => api.get<InsightsLatestResponse>(
      `/api/v2/social-listening/insights/latest?channelId=${encodeURIComponent(channelId!)}`,
    ),
    refetchInterval: refetch,
  });

  const history = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-history', channelId],
    queryFn: () => api.get<InsightsHistoryResponse>(
      `/api/v2/social-listening/insights/history?channelId=${encodeURIComponent(channelId!)}&limit=20`,
    ),
    refetchInterval: live && isToday ? 30_000 : false,
  });

  // Boxes do relatório (mensagens/pico/janelas) para o dia selecionado…
  const summary = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-summary', channelId, date],
    queryFn: () => fetchInsightsSummary(channelId!, from, to),
    refetchInterval: refetch ? 60_000 : false,
  });
  // …e dias ativos no mês corrente (30 dias pra trás).
  const monthSummary = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-summary-30d', channelId],
    queryFn: () => {
      const monthFrom = dayBoundsIso(shiftYmd(todayYmd(), -30)).from;
      const monthTo = dayBoundsIso(todayYmd()).to;
      return fetchInsightsSummary(channelId!, monthFrom, monthTo);
    },
    staleTime: 5 * 60_000,
  });

  // Marcas mencionadas precisam ser AGREGADAS — uma janela de 15s
  // raramente captura menção. Acumulamos os hits dos últimos 20 batches.
  const aggregatedBrands = useMemo(() => {
    const items = history.data?.items ?? [];
    const acc = new Map<string, { count: number; sample: string[] }>();
    for (const b of items) {
      for (const m of b.marcasMencionadas ?? []) {
        const cur = acc.get(m.brand) ?? { count: 0, sample: [] };
        cur.count += m.count;
        if (m.sample) {
          for (const s of m.sample) {
            if (cur.sample.length < 5 && !cur.sample.includes(s)) cur.sample.push(s);
          }
        }
        acc.set(m.brand, cur);
      }
    }
    return Array.from(acc.entries())
      .map(([brand, v]) => ({ brand, count: v.count, sample: v.sample }))
      .sort((a, b) => b.count - a.count);
  }, [history.data]);

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Ao vivo"
        title={<>Análise de <span className="text-accent-400">sentimentos</span></>}
        description="Clima do chat, pautas e marcas ao longo da live."
        info="Acompanhe como o chat reagiu ao longo da live: clima geral, assuntos, palavras-chave, marcas e picos de atividade. Use o seletor de dia no gráfico para revisitar lives passadas. (Texto provisório.)"
      />

      <ChannelStatusBanner channelId={channelId} />

      <ClimateAlert items={history.data?.items ?? []} />

      {channelId ? (
        <ActivityAreaChart
          channelId={channelId}
          date={date}
          onDateChange={setDate}
          live={live}
          onLiveChange={setLive}
        />
      ) : null}

      {/* Boxes do relatório na página (mensagens, dias ativos, picos, janelas) */}
      {channelId && summary.data ? (
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatBox label="Mensagens" value={summary.data.totalMessages.toLocaleString('pt-BR')} foot="no dia selecionado" />
          <StatBox
            label="Dias ativos"
            value={monthSummary.data ? String(monthSummary.data.activeDays) : '—'}
            foot="últimos 30 dias"
          />
          <StatBox label="Pico de usuários" value={summary.data.peakUsers.toLocaleString('pt-BR')} foot="numa janela do dia" />
          <StatBox label="Janelas" value={summary.data.windows.toLocaleString('pt-BR')} foot="blocos analisados" />
        </section>
      ) : null}

      {/* Box de palavras-chave (standalone) */}
      {channelId && (summary.data?.topKeywords.length ?? 0) > 0 ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <p className="eyebrow">Palavras-chave</p>
            <span className="text-xs text-ink-400">mais usadas no período</span>
          </div>
          <ul className="mt-3 flex flex-wrap gap-2">
            {summary.data!.topKeywords.slice(0, 18).map((k) => (
              <li
                key={k.word}
                className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5"
              >
                <span className="text-sm text-ink-800">{k.word}</span>
                <Badge tone="accent">{k.count}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {!channelId ? (
        <EmptyState
          title="Selecione um canal"
          description="Escolha um canal conectado no menu lateral para ver as análises."
        />
      ) : latest.isLoading ? (
        <Card>Carregando…</Card>
      ) : latest.data?.analysis ? (
        <InsightCards
          analysis={latest.data.analysis}
          brandsOverride={aggregatedBrands}
          channelId={channelId}
          from={from}
          to={to}
        />
      ) : (
        <EmptyState
          title="Nenhuma análise ainda"
          description="Assim que o canal abrir uma live monitorada, as análises aparecem aqui."
        />
      )}

      {channelId ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChatTopicsPanel channelId={channelId} from={from} to={to} />
          <LiveFeed channelId={channelId} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Alerta de clima — compara o sentimento (ponderado por volume) das 5 janelas
 * mais recentes com as 15 anteriores; queda forte com volume relevante vira
 * um aviso no topo da página, com a causa provável nos assuntos abaixo.
 */
function ClimateAlert({ items }: { items: BatchAnalysis[] }) {
  const alert = useMemo(() => {
    if (items.length < 10) return null;
    const weighted = (batch: BatchAnalysis[]) => {
      let msgs = 0;
      let pos = 0;
      for (const b of batch) {
        msgs += b.messageCount;
        pos += (b.climaGeral?.pos ?? 0) * b.messageCount;
      }
      return msgs > 0 ? { pct: Math.round((pos / msgs) * 100), msgs } : null;
    };
    const recent = weighted(items.slice(0, 5)); // itens chegam do mais novo p/ o mais velho
    const prev = weighted(items.slice(5, 20));
    if (!recent || !prev) return null;
    if (recent.msgs < 30) return null;
    if (prev.pct - recent.pct < 15) return null;
    return { from: prev.pct, to: recent.pct };
  }, [items]);

  if (!alert) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warn/30 bg-warn/[0.06] px-5 py-3.5">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0" aria-hidden>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
      </svg>
      <p className="text-sm text-ink-700">
        <b className="text-warn">Clima do chat caindo:</b> {alert.from}% → {alert.to}% positivo
        nas últimas janelas. A causa provável está nos assuntos e no recorte do gráfico abaixo.
      </p>
    </div>
  );
}

function StatBox({ label, value, foot }: { label: string; value: string; foot?: string }) {
  return (
    <article className="glass-card">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-ink-800">{value}</p>
      {foot ? <p className="mt-1 text-xs text-ink-400">{foot}</p> : null}
    </article>
  );
}
