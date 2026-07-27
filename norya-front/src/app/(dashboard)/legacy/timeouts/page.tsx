'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import { Badge } from '@/components/ui/badge';
import type { TimeoutRow } from '@/lib/legacy-types';

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

const columns: LegacyColumn<TimeoutRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '180px', render: (r) => fmtDate(r.timestamp) },
  { key: 'userName',  header: 'Usuário', width: '200px', mono: true },
  {
    key: 'tempoDeTO',
    header: 'Duração',
    width: '120px',
    render: (r) => <Badge tone="warn">{fmtDuration(r.tempoDeTO)}</Badge>,
  },
  { key: 'modName',   header: 'Mod', width: '180px', mono: true },
  { key: 'reason',    header: 'Motivo', render: (r) => r.reason || <span className="text-ink-400">—</span> },
];

export default function TimeoutsPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Moderação"
        title="Timeouts"
        description="Silenciamentos temporários deste canal: quem levou, por quanto tempo e por quê."
        info="Os timeouts aplicados pelos seus mods, com a duração de cada um. Recorte por período e exporte quando precisar. O canal acompanha o que estiver ativo no menu da conta."
      />
      <LegacyTable<TimeoutRow>
        resource="timeouts"
        queryKey="legacy:timeouts"
        columns={columns}
        noun="timeouts"
        emptyTitle="Nenhum timeout por aqui"
        emptyDescription="Este canal não tem silenciamentos no período. Assim que um mod der um timeout, ele aparece aqui."
      />
    </div>
  );
}
