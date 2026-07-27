'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import { Badge } from '@/components/ui/badge';
import type { PollRow } from '@/lib/legacy-types';

const columns: LegacyColumn<PollRow>[] = [
  { key: 'createdAt', header: 'Início', width: '180px', render: (r) => fmtDate(r.createdAt) },
  { key: 'title',     header: 'Título', render: (r) => r.title ?? <span className="text-ink-400">—</span> },
  {
    key: 'winningTitle',
    header: 'Mais votada',
    width: '200px',
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
    width: '130px',
    render: (r) => r.totalAllVotes.toLocaleString('pt-BR'),
  },
];

export default function PollsPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Engajamento"
        title="Enquetes"
        description="As enquetes que rolaram neste canal e como a audiência votou, com a opção mais votada em destaque."
        info="Enquetes da Twitch deste canal (votos por chat, channel points e bits), com a vencedora pelo total agregado. Recorte por período e exporte em CSV. O canal acompanha o que estiver ativo no menu da conta."
      />
      <LegacyTable<PollRow>
        resource="polls"
        queryKey="legacy:polls"
        columns={columns}
        noun="enquetes"
        emptyTitle="Nenhuma enquete no período"
        emptyDescription="Este canal não abriu enquetes no período selecionado."
      />
    </div>
  );
}
