'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LegacyTable, fmtDate, type LegacyColumn } from '@/components/legacy/legacy-table';
import type { BanRow } from '@/lib/legacy-types';

const columns: LegacyColumn<BanRow>[] = [
  { key: 'timestamp', header: 'Quando', width: '180px', render: (r) => fmtDate(r.timestamp) },
  { key: 'userName',  header: 'Usuário', width: '200px', mono: true },
  { key: 'modName',   header: 'Mod',     width: '180px', mono: true },
  { key: 'reason',    header: 'Motivo',  render: (r) => r.reason || <span className="text-ink-400">—</span> },
];

export default function BansPage() {
  return (
    <div className="flex flex-col gap-10 pb-20">
      <PageHeader
        eyebrow="Moderação"
        title="Bans"
        description="Todo banimento aplicado no chat deste canal: quem foi banido, quando, por qual mod e por quê."
        info="O histórico de bans registrado pelos seus bots de moderação. Recorte por período e exporte em CSV pra auditoria ou pra levar pra outra ferramenta. O canal acompanha o que estiver ativo no menu da conta."
      />
      <LegacyTable<BanRow>
        resource="bans"
        queryKey="legacy:bans"
        columns={columns}
        noun="bans"
        emptyTitle="Nenhum ban por aqui"
        emptyDescription="Este canal não tem banimentos no período. Assim que um mod banir alguém, o registro aparece aqui."
      />
    </div>
  );
}
