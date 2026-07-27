'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import type { RemovedRow } from '@/lib/legacy-types';

const columns: LegacyColumn<RemovedRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '180px', render: (r) => fmtDate(r.timestamp) },
  { key: 'username',  header: 'Usuário', width: '200px', mono: true },
  { key: 'deletedMessage', header: 'Mensagem removida', mono: true },
];

export default function RemovedPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Moderação"
        title="Mensagens removidas"
        description="Mensagens apagadas do chat depois de enviadas."
        info="Cada mensagem deletada do chat deste canal fica registrada aqui, com o autor e o conteúdo original. Útil pra revisar moderação e auditar decisões. O canal acompanha o que estiver ativo no menu da conta."
      />
      <LegacyTable<RemovedRow>
        resource="removed"
        queryKey="legacy:removed"
        columns={columns}
        noun="mensagens"
        emptyTitle="Nada removido no período"
        emptyDescription="Nenhuma mensagem deste canal foi apagada no período selecionado."
      />
    </div>
  );
}
