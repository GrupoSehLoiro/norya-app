'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import { Badge } from '@/components/ui/badge';
import type { PredictionRow } from '@/lib/legacy-types';

const columns: LegacyColumn<PredictionRow>[] = [
  { key: 'createdAt', header: 'Início', width: '160px', render: (r) => fmtDate(r.createdAt) },
  { key: 'channel',   header: 'Canal', width: '140px', render: (r) => r.channel ?? '—' },
  { key: 'title',     header: 'Título', render: (r) => r.title ?? <span className="text-ink-400">—</span> },
  {
    key: 'winningTitle',
    header: 'Vencedora',
    width: '180px',
    render: (r) =>
      r.winningTitle ? (
        <Badge tone="positive">{r.winningTitle}</Badge>
      ) : (
        <span className="text-ink-400">—</span>
      ),
  },
  {
    key: 'totalPoints',
    header: 'Pontos',
    width: '110px',
    render: (r) => r.totalPoints.toLocaleString('pt-BR'),
  },
  {
    key: 'totalUsers',
    header: 'Apostadores',
    width: '120px',
    render: (r) => r.totalUsers.toLocaleString('pt-BR'),
  },
];

export default function PredictionsPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Legado · Engajamento"
        title="Predictions"
        description="Predictions da Twitch encerradas no canal. Vencedora destacada, totais agregados."
      />
      <LegacyTable<PredictionRow>
        resource="predictions"
        queryKey="legacy:predictions"
        columns={columns}
        showChannelsFromResponse
        emptyTitle="Nenhuma prediction no período"
      />
    </div>
  );
}
