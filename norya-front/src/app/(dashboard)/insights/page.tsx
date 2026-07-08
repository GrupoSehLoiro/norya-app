'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ChannelStatusBanner } from '@/components/insights/channel-status-banner';
import { InsightCards } from '@/components/insights/insight-cards';
import { LiveFeed } from '@/components/insights/live-feed';
import { ChatTopicsPanel } from '@/components/insights/chat-topics-panel';
import { ActivityAreaChart } from '@/components/insights/activity-area-chart';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api-client';
import { useSelectedChannel } from '@/hooks/use-selected-channel';
import type { InsightsLatestResponse, InsightsHistoryResponse } from '@/lib/types';

export default function InsightsPage() {
  const { channelId } = useSelectedChannel();

  const latest = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-latest', channelId],
    queryFn: () => api.get<InsightsLatestResponse>(
      `/api/v2/social-listening/insights/latest?channelId=${encodeURIComponent(channelId!)}`,
    ),
    refetchInterval: 15_000,
  });

  const history = useQuery({
    enabled: !!channelId,
    queryKey: ['insights-history', channelId],
    queryFn: () => api.get<InsightsHistoryResponse>(
      `/api/v2/social-listening/insights/history?channelId=${encodeURIComponent(channelId!)}&limit=20`,
    ),
    refetchInterval: 30_000,
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
      />

      <ChannelStatusBanner channelId={channelId} />

      {channelId ? <ActivityAreaChart channelId={channelId} /> : null}

      {!channelId ? (
        <EmptyState
          title="Selecione um canal"
          description="Para ver insights, primeiro cadastre/escolha um canal monitorado."
        />
      ) : latest.isLoading ? (
        <Card>Carregando…</Card>
      ) : latest.data?.analysis ? (
        <InsightCards analysis={latest.data.analysis} brandsOverride={aggregatedBrands} />
      ) : (
        <EmptyState
          title="Nenhum batch ainda"
          description="O orchestrator está IDLE ou o canal não recebeu msgs ainda. Verifique SOCIAL_LISTENING_CHANNELS no .env do backend."
        />
      )}

      {channelId ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChatTopicsPanel channelId={channelId} />
          <LiveFeed channelId={channelId} />
        </div>
      ) : null}
    </div>
  );
}
