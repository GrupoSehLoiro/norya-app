'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import type { RemovedRow } from '@/lib/legacy-types';

const columns: LegacyColumn<RemovedRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '170px', render: (r) => fmtDate(r.timestamp) },
  { key: 'channel',   header: 'Canal', width: '160px' },
  { key: 'username',  header: 'Usuário', width: '180px', mono: true },
  { key: 'deletedMessage', header: 'Mensagem removida', mono: true },
];

export default function RemovedPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Legado · Moderação"
        title="Mensagens removidas"
        description="Mensagens deletadas do chat após envio. Útil pra revisão de moderação e auditoria."
      />
      <LegacyTable<RemovedRow>
        resource="removed"
        queryKey="legacy:removed"
        columns={columns}
        emptyTitle="Nenhuma mensagem removida no período"
      />
    </div>
  );
}
