'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import { Badge } from '@/components/ui/badge';
import type { PollRow } from '@/lib/legacy-types';

const columns: LegacyColumn<PollRow>[] = [
  { key: 'createdAt', header: 'Início', width: '160px', render: (r) => fmtDate(r.createdAt) },
  { key: 'channel',   header: 'Canal',  width: '140px', render: (r) => r.channel ?? '—' },
  { key: 'title',     header: 'Título', render: (r) => r.title ?? <span className="text-ink-400">—</span> },
  {
    key: 'winningTitle',
    header: 'Mais votada',
    width: '180px',
    render: (r) =>
      r.winningTitle ? (
        <Badge tone="positive">{r.winningTitle}</Badge>
      ) : (
        <span className="text-ink-400">—</span>
      ),
  },
  {
    key: 'totalAllVotes',
    header: 'Votos totais',
    width: '120px',
    render: (r) => r.totalAllVotes.toLocaleString('pt-BR'),
  },
];

export default function PollsPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Legado · Engajamento"
        title="Polls"
        description="Enquetes da Twitch (votos por chat, channel points e bits). Vencedora pelo total agregado."
      />
      <LegacyTable<PollRow>
        resource="polls"
        queryKey="legacy:polls"
        columns={columns}
        showChannelsFromResponse
        emptyTitle="Nenhuma poll no período"
      />
    </div>
  );
}
