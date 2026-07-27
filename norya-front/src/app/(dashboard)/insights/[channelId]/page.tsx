'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ChannelStatusBanner } from '@/components/insights/channel-status-banner';
import { InsightCards } from '@/components/insights/insight-cards';
import { HistoryTable } from '@/components/insights/history-table';
import { LiveFeed } from '@/components/insights/live-feed';
import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api-client';
import { dayBoundsIso, todayYmd } from '@/lib/day-range';
import type { InsightsLatestResponse, InsightsHistoryResponse } from '@/lib/types';

export default function ChannelInsightsPage() {
  const params = useParams<{ channelId: string }>();
  const channelId = params.channelId;

  const latest = useQuery({
    queryKey: ['insights-latest', channelId],
    queryFn: () => api.get<InsightsLatestResponse>(
      `/api/v2/social-listening/insights/latest?channelId=${encodeURIComponent(channelId)}`,
    ),
    refetchInterval: 15_000,
  });
  const history = useQuery({
    queryKey: ['insights-history', channelId],
    queryFn: () => api.get<InsightsHistoryResponse>(
      `/api/v2/social-listening/insights/history?channelId=${encodeURIComponent(channelId)}&limit=50`,
    ),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow={`Canal · #${channelId.slice(0, 8)}`}
        title="Vista detalhada"
        description="Insights ao vivo + histórico completo."
      />

      <ChannelStatusBanner channelId={channelId} />

      {latest.data?.analysis
        ? (
          <InsightCards
            analysis={latest.data.analysis}
            channelId={channelId}
            from={dayBoundsIso(todayYmd()).from}
            to={dayBoundsIso(todayYmd()).to}
          />
        )
        : <EmptyState title="Sem análises" description="Nenhuma análise para este canal ainda." />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader eyebrow="Histórico" title="Batches recentes" />
          <HistoryTable items={history.data?.items ?? []} />
        </Card>
        <div className="lg:col-span-1">
          <LiveFeed channelId={channelId} />
        </div>
      </div>
    </div>
  );
}
