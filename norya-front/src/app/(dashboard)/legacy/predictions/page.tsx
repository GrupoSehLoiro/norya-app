'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import { Badge } from '@/components/ui/badge';
import type { PredictionRow } from '@/lib/legacy-types';

const columns: LegacyColumn<PredictionRow>[] = [
  { key: 'createdAt', header: 'Início', width: '180px', render: (r) => fmtDate(r.createdAt) },
  { key: 'title',     header: 'Título', render: (r) => r.title ?? <span className="text-ink-400">—</span> },
  {
    key: 'winningTitle',
    header: 'Vencedora',
    width: '200px',
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
    width: '120px',
    render: (r) => r.totalPoints.toLocaleString('pt-BR'),
  },
  {
    key: 'totalUsers',
    header: 'Apostadores',
    width: '130px',
    render: (r) => r.totalUsers.toLocaleString('pt-BR'),
  },
];

export default function PredictionsPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Engajamento"
        title="Predictions"
        description="As predictions encerradas neste canal: a opção vencedora, os pontos em jogo e quantos apostaram."
        info="Predictions da Twitch encerradas neste canal, com totais agregados e a vencedora destacada. Recorte por período e exporte em CSV. O canal acompanha o que estiver ativo no menu da conta."
      />
      <LegacyTable<PredictionRow>
        resource="predictions"
        queryKey="legacy:predictions"
        columns={columns}
        noun="predictions"
        emptyTitle="Nenhuma prediction no período"
        emptyDescription="Este canal não teve predictions encerradas no período selecionado."
      />
    </div>
  );
}
